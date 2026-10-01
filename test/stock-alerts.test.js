const assert = require('node:assert/strict');
const test = require('node:test');
const { stockFromCsv, buildStockAlerts, planOfWine, toNumber } = require('../lib/stock-alerts');

test('銘柄IDからプランを引く', () => {
  assert.equal(planOfWine('vol.2-1'), 'Vol.2');
  assert.equal(planOfWine('vol.12-4'), 'Vol.12');
  assert.equal(planOfWine('Pro.3'), 'PRO');
  assert.equal(planOfWine('プログラム'), null);
});

test('「6本」「¥9,600」「-1」を数値にする', () => {
  assert.equal(toNumber('6本'), 6);
  assert.equal(toNumber('¥9,600'), 9600);
  assert.equal(toNumber('-1'), -1);
  assert.equal(toNumber(''), null);
});

test('在庫タブを見出し名で読む（上の説明行は読み飛ばす）', () => {
  const csv = [
    'プログラム在庫（アプリ記録と自動連動）,,,,,,,,',
    '現在在庫 合計,931本,,"¥3,277,218",,説明,,,',
    'プログラム,ワイン名,基準在庫,入荷累計,瓶詰め使用,販売出荷,現在在庫,仕入価格（税抜・手入力）,在庫金額',
    'vol.1-1,シャトー モンテレーナ,16本,32本,42本,0本,6本,"¥9,600","¥57,600"',
    'vol.12-3,シルバー ハイツ,10本,12本,23本,0本,-1本,,',
    'Pro.1,（ワイン名未設定）,0本,108本,0本,0本,108本,,¥0',
    '合計,,,,,,,,',
  ].join('\n');
  assert.deepEqual(stockFromCsv(csv), [
    { id: 'vol.1-1', name: 'シャトー モンテレーナ', stock: 6, price: 9600, bottled: 42 },
    { id: 'vol.12-3', name: 'シルバー ハイツ', stock: -1, price: null, bottled: 23 },
    { id: 'Pro.1', name: '', stock: 108, price: null, bottled: 0 },
  ]);
});

test('見出しがなければエラー', () => {
  assert.throws(() => stockFromCsv('a,b\n1,2\n'), /見出しが見つかりません/);
});

// 10/1(木)が今日。Vol.2 は 10/2(金) 8件・10/6(火) 8件・10/9(金) 16件（計32件 → 5本）
const days = [
  { date: '2026-10-02', plans: [{ label: 'Vol.2', count: 8 }, { label: 'Vol.3', count: 3 }] },
  { date: '2026-10-06', plans: [{ label: 'Vol.2', count: 8 }] },
  { date: '2026-10-09', plans: [{ label: 'Vol.2', count: 16 }] },
];
const opts = { today: '2026-10-01', factor: 7.5, leadDays: 2, lowStock: 6 };
const byId = (result) => Object.fromEntries(result.items.map((i) => [i.id, i]));

test('在庫でまかなえる件数を超える日が「足りなくなる日」、その2日前（平日）が発注期限', () => {
  const r = byId(buildStockAlerts(days, [
    { id: 'vol.2-1', name: 'A', stock: 2, price: 1000 },  // 小瓶15本分 → 10/6 に累計16で尽きる
    { id: 'vol.2-2', name: 'B', stock: 1, price: null },  // 小瓶7.5本分 → 10/2 に累計8で尽きる
    { id: 'vol.2-3', name: 'C', stock: 20, price: null }, // 足りる（必要5本）が、6本超なのでOK
    { id: 'vol.2-4', name: 'D', stock: 6, price: null },  // 足りる（必要5本）が、6本以下
    { id: 'vol.3-1', name: 'E', stock: 0, price: null },  // 在庫0、10/2 に3件 → 間に合わない
  ], opts));

  // A: 10/6(火)に尽きる → 1週間前の 9/29(火) に届いている必要 → 発注期限 9/27(日) → 9/25(金)。過ぎているので「至急」
  assert.equal(r['vol.2-1'].runsOutOn, '2026-10-06');
  assert.equal(r['vol.2-1'].arriveBy, '2026-09-29');
  assert.equal(r['vol.2-1'].orderBy, '2026-09-25');
  assert.equal(r['vol.2-1'].orderByWeekday, '金');
  assert.equal(r['vol.2-1'].level, 'urgent');
  assert.equal(r['vol.2-1'].need, 5);
  assert.equal(r['vol.2-1'].shortage, 3);
  assert.equal(r['vol.2-1'].shortage, 3); // 5本 − 在庫2本（在庫を残す分は足さない）
  assert.equal(r['vol.2-1'].suggested, undefined);

  // B: 10/2(金) に尽きる → 到着期限 9/25(金) → 発注期限 9/23(水)。今日より前なので「至急」＋間に合わない注記
  assert.equal(r['vol.2-2'].runsOutOn, '2026-10-02');
  assert.equal(r['vol.2-2'].arriveBy, '2026-09-25');
  assert.equal(r['vol.2-2'].orderBy, '2026-09-23');
  assert.equal(r['vol.2-2'].level, 'urgent');
  assert.match(r['vol.2-2'].notes.join(), /期限を過ぎています/);

  assert.equal(r['vol.2-3'].level, 'ok');
  assert.equal(r['vol.2-3'].runsOutOn, null);
  assert.equal(r['vol.2-4'].level, 'low');
  assert.equal(r['vol.3-1'].level, 'urgent');
});

test('出荷予定がなくても、6本以下なら知らせる。マイナス在庫は0として扱い注記する', () => {
  const r = byId(buildStockAlerts(days, [
    { id: 'vol.1-1', name: 'X', stock: 6, price: null },
    { id: 'vol.1-2', name: 'Y', stock: 7, price: null },
    { id: 'vol.12-3', name: 'Z', stock: -1, price: null },
  ], opts));
  assert.equal(r['vol.1-1'].level, 'low');
  assert.equal(r['vol.1-1'].shipments, 0);
  assert.equal(r['vol.1-2'].level, 'ok');
  assert.equal(r['vol.12-3'].level, 'low');
  assert.match(r['vol.12-3'].notes.join(), /マイナス/);
});

test('今日より前の出荷は数えない。並びは 至急 → 今週中 → その後 → 残り少ない → OK', () => {
  const result = buildStockAlerts(days, [
    { id: 'vol.2-3', name: 'C', stock: 20, price: null },
    { id: 'vol.2-4', name: 'D', stock: 6, price: null },
    { id: 'vol.2-1', name: 'A', stock: 2, price: null },
    { id: 'vol.2-2', name: 'B', stock: 1, price: null },
  ], { ...opts, today: '2026-10-03' });
  // 10/2 の8件は過ぎているので、Vol.2 の今後は 24件 → 4本
  assert.equal(result.items.find((i) => i.id === 'vol.2-3').need, 4);
  // B: 10/6 に尽きる → 到着 9/29 → 発注 9/25 → 至急。A: 10/9 に尽きる → 到着 10/2 → 発注 9/30 → 至急
  assert.deepEqual(result.items.map((i) => [i.id, i.level]), [['vol.2-2', 'urgent'], ['vol.2-1', 'urgent'], ['vol.2-4', 'low'], ['vol.2-3', 'ok']]);
  assert.deepEqual(result.counts, { urgent: 2, soon: 0, later: 0, low: 1, ok: 1 });
  assert.equal(result.horizonEnd, '2026-10-09');
});

test('ちょうど使い切る件数なら、尽きたとはみなさない', () => {
  const r = byId(buildStockAlerts([{ date: '2026-10-05', plans: [{ label: 'Vol.2', count: 15 }] }],
    [{ id: 'vol.2-1', name: 'A', stock: 2, price: null }], { ...opts, lowStock: 0 }));
  assert.equal(r['vol.2-1'].runsOutOn, null);
  assert.equal(r['vol.2-1'].shortage, 0);
  assert.equal(r['vol.2-1'].level, 'ok');
});

test('発注期限が1週間より先なら「その後」', () => {
  const series = [{ date: '2026-10-20', plans: [{ label: 'Vol.2', count: 30 }] }];
  const r = byId(buildStockAlerts(series, [{ id: 'vol.2-1', name: 'A', stock: 2, price: null }], opts));
  assert.equal(r['vol.2-1'].runsOutOn, '2026-10-20');
  assert.equal(r['vol.2-1'].arriveBy, '2026-10-13'); // 10/20(火) の1週間前
  assert.equal(r['vol.2-1'].orderBy, '2026-10-09');  // 10/11(日) → 10/9(金)
  assert.equal(r['vol.2-1'].level, 'later');
});

test('PRO は出荷日（27日）の2週間前までに届くよう、到着期限と発注期限を早める', () => {
  const series = [{ date: '2026-10-27', plans: [{ label: 'PRO', count: 948 }] }]; // 1銘柄 127本必要
  const run = (today) => byId(buildStockAlerts(series, [{ id: 'Pro.1', name: '', stock: 108, price: null }], { ...opts, today }));
  const r = run('2026-09-29');
  assert.equal(r['Pro.1'].runsOutOn, '2026-10-27');
  assert.equal(r['Pro.1'].arriveBy, '2026-10-13');   // 10/27(火) の14日前 = 10/13(火)
  assert.equal(r['Pro.1'].orderBy, '2026-10-09');    // 到着期限の2日前 10/11(日) → 10/9(金)
  assert.equal(r['Pro.1'].orderByWeekday, '金');
  assert.equal(r['Pro.1'].level, 'later');           // 9/29 から見て期限は6日より先
  assert.equal(run('2026-10-05')['Pro.1'].level, 'soon');   // 期限まで4日
  assert.equal(run('2026-10-08')['Pro.1'].level, 'urgent'); // 期限が明日
  assert.match(run('2026-10-12')['Pro.1'].notes.join(), /期限を過ぎています/);
  assert.match(r['Pro.1'].notes.join(), /14日前/);
});

test('到着期限が土日なら直前の金曜日（PRO）。Vol は到着期限＝足りなくなる日', () => {
  // 11/27(金) 出荷の PRO → 14日前 11/13(金) → 発注 11/11(水)
  const pro = byId(buildStockAlerts([{ date: '2026-11-27', plans: [{ label: 'PRO', count: 10 }] }],
    [{ id: 'Pro.2', name: '', stock: 0, price: null }], { ...opts, today: '2026-10-01' }));
  assert.equal(pro['Pro.2'].arriveBy, '2026-11-13');
  assert.equal(pro['Pro.2'].orderBy, '2026-11-11');
  // 12/25(金) 出荷の PRO（12/27 が日曜のため前倒し済み）→ 14日前 12/11(金) → 発注 12/9(水)
  const dec = byId(buildStockAlerts([{ date: '2026-12-25', plans: [{ label: 'PRO', count: 10 }] }],
    [{ id: 'Pro.3', name: '', stock: 0, price: null }], { ...opts, today: '2026-10-01' }));
  assert.equal(dec['Pro.3'].arriveBy, '2026-12-11');
  assert.equal(dec['Pro.3'].orderBy, '2026-12-09');
  // Vol は1週間前。10/6(火) に尽きる → 9/29(火)
  const vol = byId(buildStockAlerts(days, [{ id: 'vol.2-1', name: 'A', stock: 2, price: null }], opts));
  assert.equal(vol['vol.2-1'].arriveBy, '2026-09-29');
});

test('Vol.1 は月平均130件の見込みで判定する（30日で1銘柄18本）', () => {
  const r = byId(buildStockAlerts(days, [
    { id: 'vol.1-1', name: 'M', stock: 6, price: null },
    { id: 'vol.1-2', name: 'G', stock: 0, price: null },
    { id: 'vol.1-3', name: 'C', stock: 30, price: null },
  ], { ...opts, forecasts: { 'Vol.1': 130 } }));
  assert.equal(r['vol.1-1'].forecast, 130);
  assert.equal(r['vol.1-1'].shipments, 130);
  assert.equal(r['vol.1-1'].need, 18);          // 130 ÷ 7.5 = 17.3 → 18
  assert.equal(r['vol.1-1'].shortage, 12);
  assert.ok(r['vol.1-1'].runsOutOn);             // 45件分（6本×7.5）を超える日がある
  assert.equal(r['vol.1-2'].level, 'urgent');     // 在庫0 → 最初の平日に足りなくなる
  assert.equal(r['vol.1-2'].runsOutOn, '2026-10-01');
  assert.equal(r['vol.1-3'].level, 'ok');         // 30本あれば足りて、6本超
  assert.match(r['vol.1-1'].notes.join(), /月平均130件/);
});

test('実際の出荷予定があるプランには見込みを使わない', () => {
  const r = byId(buildStockAlerts(days, [{ id: 'vol.2-1', name: 'A', stock: 20, price: null }], { ...opts, forecasts: { 'Vol.2': 999 } }));
  assert.equal(r['vol.2-1'].forecast, null);
  assert.equal(r['vol.2-1'].shipments, 32);
});

test('Vol は出荷日の1週間前に届いている必要がある。1週間前が土日なら金曜日', () => {
  const run = (date, today) => byId(buildStockAlerts([{ date, plans: [{ label: 'Vol.5', count: 30 }] }],
    [{ id: 'vol.5-1', name: 'H', stock: 1, price: null }], { ...opts, today }))['vol.5-1'];
  const mon = run('2026-10-19', '2026-10-01');      // 10/19(月) の1週間前 = 10/12(月) → 発注 10/10(土) → 10/9(金)
  assert.deepEqual([mon.arriveBy, mon.orderBy, mon.level], ['2026-10-12', '2026-10-09', 'later']);
  const soon = run('2026-10-19', '2026-10-05');     // 期限まで4日
  assert.equal(soon.level, 'soon');
  const tight = run('2026-10-19', '2026-10-08');    // 期限が明日
  assert.equal(tight.level, 'urgent');
  // 1週間前を変えられる
  const custom = byId(buildStockAlerts([{ date: '2026-10-19', plans: [{ label: 'Vol.5', count: 30 }] }],
    [{ id: 'vol.5-1', name: 'H', stock: 1, price: null }], { ...opts, arriveDaysBefore: 0 }))['vol.5-1'];
  assert.equal(custom.arriveBy, '2026-10-19');
});

test('瓶詰め済みの小瓶を出荷に回すと、足りなくなる日が延び、必要本数が減る', () => {
  // Vol.2 は 10/2 に8件、10/6 に8件、10/9 に16件（計32件）。在庫1本（7.5件分）
  const base = { ...opts, today: '2026-10-01' };
  const without = byId(buildStockAlerts(days, [{ id: 'vol.2-1', name: 'A', stock: 1, price: null }], base))['vol.2-1'];
  assert.equal(without.runsOutOn, '2026-10-02');
  assert.equal(without.need, 5);
  // 小瓶が 15本 あれば、在庫1本と合わせて 22.5件分 → 10/9 に尽きる。必要は ceil((32-15)/7.5)=3本
  const withSmall = byId(buildStockAlerts(days, [{ id: 'vol.2-1', name: 'A', stock: 1, price: null }], { ...base, smallBottles: { 'vol.2-1': 15 } }))['vol.2-1'];
  assert.equal(withSmall.smallBottles, 15);
  assert.equal(withSmall.runsOutOn, '2026-10-09');
  assert.equal(withSmall.need, 3);
  assert.equal(withSmall.shortage, 2);
  assert.equal(withSmall.shipments, 32); // 画面の内訳：出荷32件（小瓶32本）− 小瓶15本 − 在庫1本（小瓶7.5本分）＝ 小瓶9.5本分 → ボトル2本
  // 小瓶だけで全部まかなえるなら、ワインは要らない
  const enough = byId(buildStockAlerts(days, [{ id: 'vol.2-1', name: 'A', stock: 20, price: null }], { ...base, smallBottles: { 'vol.2-1': 40 } }))['vol.2-1'];
  assert.equal(enough.need, 0);
  assert.equal(enough.runsOutOn, null);
  assert.equal(enough.level, 'ok');
});

test('至急は発注期限が明日までの出荷分に必ず必要な本数だけ。残りは出荷日の月ごとに分け、至急に入れない', () => {
  // 今日 10/1(木)。Vol は出荷日の7日前に到着、その2日前（平日）が発注期限
  //   10/13(火)出荷 → 到着 10/6 → 発注 10/4(日)→10/2(金)：明日まで → 至急
  //   10/20(火)出荷 → 到着 10/13 → 発注 10/11(日)→10/9(金)：至急ではない
  const days = [['2026-10-02', 20], ['2026-10-09', 20], ['2026-10-13', 20], ['2026-10-20', 20], ['2026-11-04', 20]]
    .map(([date, count]) => ({ date, plans: [{ label: 'Vol.8', count }] }));
  const item = buildStockAlerts(days, [{ id: 'vol.8-4', name: 'K', stock: 0, price: null }], { today: '2026-10-01', factor: 7.5, smallBottles: { 'vol.8-4': 25 } }).items[0];
  assert.equal(item.level, 'urgent');
  // 10/13 までの60件 − 小瓶25本 = 35本分 → ボトル5本（在庫を残す分は足さない）
  assert.equal(item.urgentNeed, 5);
  assert.equal(item.urgentUntil, '2026-10-13');
  assert.equal(item.urgentDeliveryUntil, '2026-10-14');
  // 10月の残り：10/20 の分から。11月：11/4 の分。足すと不足と同じ
  assert.deepEqual(item.monthNeeds.map((m) => [m.month, m.bottles, m.from, m.orderBy]), [
    ['2026-10', 3, '2026-10-20', '2026-10-09'],
    ['2026-11', 2, '2026-11-04', '2026-10-26'],
  ]);
  assert.equal(item.urgentNeed + item.monthNeeds.reduce((sum, m) => sum + m.bottles, 0), item.shortage);
  // 金曜の出荷は月曜着の分まで含む
  const friday = buildStockAlerts([{ date: '2026-10-09', plans: [{ label: 'Vol.8', count: 8 }] }], [{ id: 'vol.8-1', name: 'A', stock: 0, price: null }], { today: '2026-10-01', factor: 7.5 }).items[0];
  assert.deepEqual([friday.urgentNeed, friday.urgentUntil, friday.urgentDeliveryUntil, friday.monthNeeds], [2, '2026-10-09', '2026-10-12', []]);
  // 至急の出荷分が在庫で足りていれば、至急は0本で、月の分だけ
  const later = buildStockAlerts(days, [{ id: 'vol.8-2', name: 'B', stock: 8, price: null }], { today: '2026-10-01', factor: 7.5 }).items[0];
  assert.equal(later.urgentNeed, 0);
  assert.equal(later.urgentUntil, null);
  assert.deepEqual(later.monthNeeds.map((m) => [m.month, m.bottles]), [['2026-10', 3], ['2026-11', 3]]);
});
