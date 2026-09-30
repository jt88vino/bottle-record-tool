const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSchedule, rowsFromCsv, shipDateFor, planLabel, parseDate, toKey } = require('../lib/shipment-schedule');

const ship = (date, label) => toKey(shipDateFor(parseDate(date), label));

test('定期回数はひとつ先の数字にし、13以上はPRO', () => {
  assert.equal(planLabel(1 + 1), 'Vol.2');
  assert.equal(planLabel(11 + 1), 'Vol.12');
  assert.equal(planLabel(12 + 1), 'PRO');
  assert.equal(planLabel(56 + 1), 'PRO');
});

test('Volは配送予定日（お客様に届く日）の前日に出荷。前日が土日なら直前の金曜日', () => {
  assert.equal(ship('2026/10/07', 'Vol.3'), '2026-10-06'); // 水に届く → 火に出荷
  assert.equal(ship('2026/10/13', 'Vol.3'), '2026-10-12'); // 火に届く → 月に出荷
  assert.equal(ship('2026/10/12', 'Vol.3'), '2026-10-09'); // 月に届く → 前日が日曜 → 金に出荷
  assert.equal(ship('2026/10/10', 'Vol.3'), '2026-10-09'); // 土に届く → 金に出荷
  assert.equal(ship('2026/10/11', 'Vol.3'), '2026-10-09'); // 日に届く → 前日が土曜 → 金に出荷
  assert.equal(ship('2026/11/02', 'Vol.3'), '2026-10-30'); // 月をまたぐ → 前月の金曜
  assert.equal(ship('2026/10/01', 'Vol.3'), '2026-09-30'); // 月初に届く → 前月末に出荷
});

test('PROは配送予定日の月の27日、土日なら直前の金曜日', () => {
  assert.equal(ship('2026/10/04', 'PRO'), '2026-10-27'); // 10/27 は火曜
  assert.equal(ship('2026/10/31', 'PRO'), '2026-10-27');
  assert.equal(ship('2026/03/05', 'PRO'), '2026-03-27'); // 金曜
  assert.equal(ship('2026/06/10', 'PRO'), '2026-06-26'); // 6/27 は土曜 → 金曜
  assert.equal(ship('2026/12/01', 'PRO'), '2026-12-25'); // 12/27 は日曜 → 金曜
});

test('CSVから出荷日ごとの件数を集計する', () => {
  const csv = [
    '"次回配送予定日","定期回数"',
    '"2026/10/10 0:00","1"', // 土 → 10/9 Vol.2
    '"2026/10/11 0:00","1"', // 日 → 10/9 Vol.2
    '"2026/10/10 0:00","5"', // 土 → 10/9 Vol.6
    '"2026/10/09 0:00","12"', // PRO → 10/27
    '"2026/10/20 10:57","30"', // PRO → 10/27（時刻つきも読む）
  ].join('\n');
  const result = buildSchedule(rowsFromCsv(csv));
  assert.equal(result.total, 5);
  assert.deepEqual(result.days.map((d) => [d.date, d.weekday, d.total]), [
    ['2026-10-09', '金', 3],
    ['2026-10-27', '火', 2],
  ]);
  assert.deepEqual(result.days[0].plans, [{ label: 'Vol.2', count: 2 }, { label: 'Vol.6', count: 1 }]);
  assert.deepEqual(result.days[0].deliveryDates.map((d) => d.date), ['2026-10-10', '2026-10-11']);
  assert.deepEqual(result.days[0].shifted.map((d) => [d.date, d.weekday, d.count]), [['2026-10-10', '土', 2], ['2026-10-11', '日', 1]]);
  assert.equal(result.days[0].pro, null);
  assert.deepEqual(result.days[1].pro, { count: 2, from: '2026-10-09', to: '2026-10-20' });
  assert.deepEqual(result.days[1].shifted, []);
  assert.deepEqual(result.plans.map((p) => ({ label: p.label, count: p.count })), [{ label: 'Vol.2', count: 2 }, { label: 'Vol.6', count: 1 }, { label: 'PRO', count: 2 }]);
  assert.equal(result.skipped.length, 0);
});

test('列の順番が違っても読め、壊れた行は数えずに報告する', () => {
  const csv = '定期回数,次回配送予定日\n3,2026/10/07\n,2026/10/07\nx,2026/10/07\n4,日付なし\n';
  const result = buildSchedule(rowsFromCsv(csv));
  assert.equal(result.total, 1);
  assert.equal(result.skipped.length, 3);
});

test('必要な列がなければエラーにする', () => {
  assert.throws(() => rowsFromCsv('日付,回数\n2026/10/07,1\n'), /列が見つかりません/);
});

const { bottlesPerWine, winesFromConfig } = require('../lib/shipment-schedule');

test('ワインの本数は 件数÷7.5 を銘柄ごとに切り上げ', () => {
  assert.equal(bottlesPerWine(0, 7.5), 0);
  assert.equal(bottlesPerWine(1, 7.5), 1);
  assert.equal(bottlesPerWine(7, 7.5), 1);
  assert.equal(bottlesPerWine(8, 7.5), 2);
  assert.equal(bottlesPerWine(15, 7.5), 2); // ちょうど割り切れるときは切り上げない
  assert.equal(bottlesPerWine(112, 7.5), 15); // 14.93 → 15
  assert.equal(bottlesPerWine(150, 7.5), 20);
});


test('設定の Vol 名と PRO を、スケジュールのプラン名に対応づける', () => {
  const wines = winesFromConfig({ groups: [
    { label: 'vol.2', rows: [{ label: 'vol.2-1', wineName: 'A' }, { label: 'vol.2-2', wineName: 'B' }] },
    { label: 'Pro', rows: [{ label: 'Pro.1', wineName: '' }] },
    { label: 'その他', rows: [{ label: 'x', wineName: 'X' }] },
  ] });
  assert.deepEqual(Object.keys(wines), ['Vol.2', 'PRO']);
  assert.deepEqual(wines['Vol.2'], [{ id: 'vol.2-1', name: 'A' }, { id: 'vol.2-2', name: 'B' }]);
});

test('週・月ごとに件数と必要本数をまとめる', () => {
  const csv = ['次回配送予定日,定期回数',
    ...Array(8).fill('2026/10/06,1'),  // 10/6(火)に届く → 10/5(月)出荷 Vol.2 ×8
    ...Array(7).fill('2026/10/10,1'),  // 10/10(土)に届く → 10/9(金)出荷 Vol.2 ×7
    '2026/10/13,4',                    // 10/13(火)に届く → 10/12(月)出荷 Vol.5 ×1
    ...Array(16).fill('2026/10/20,20'), // PRO ×16 → 10/27
    '2026/11/03,1',                    // 11/3(火)に届く → 11/2(月)出荷 Vol.2 ×1
  ].join('\n');
  const wines = { 'Vol.2': [{ id: 'v2-1', name: 'A' }, { id: 'v2-2', name: 'B' }, { id: 'v2-3', name: 'C' }, { id: 'v2-4', name: 'D' }] };
  const r = buildSchedule(rowsFromCsv(csv), { factor: 7.5, wines });

  assert.equal(r.factor, 7.5);
  // 起点を指定しなければ最初の出荷日（10/5）から7日ずつ。出荷のない週も0件として並べる
  assert.equal(r.today, '2026-10-05');
  assert.deepEqual(r.weeks.map((w) => [w.start, w.end, w.total]), [
    ['2026-10-05', '2026-10-11', 15],
    ['2026-10-12', '2026-10-18', 1],
    ['2026-10-19', '2026-10-25', 0],
    ['2026-10-26', '2026-11-01', 16],
    ['2026-11-02', '2026-11-08', 1],
  ]);
  assert.equal(r.past, null);
  const w1 = r.weeks[0].plans[0];
  assert.deepEqual([w1.label, w1.count, w1.perWine, w1.wineCount, w1.bottles], ['Vol.2', 15, 2, 4, 8]);
  assert.deepEqual(w1.wines.map((w) => [w.name, w.bottles]), [['A', 2], ['B', 2], ['C', 2], ['D', 2]]);

  assert.deepEqual(r.months.map((m) => [m.key, m.total]), [['2026-10', 32], ['2026-11', 1]]);
  const oct = r.months[0];
  assert.deepEqual(oct.plans.map((p) => [p.label, p.count, p.perWine, p.bottles]), [
    ['Vol.2', 15, 2, 8],
    ['Vol.5', 1, 1, 4],   // 設定がないプランは4銘柄として数える
    ['PRO', 16, 3, 12],
  ]);
  assert.equal(oct.bottles, 24);
  // 全体は期間をまとめてから切り上げる：Vol.2 16件→3本×4、Vol.5 1件→1本×4、PRO 16件→3本×4
  assert.equal(r.bottles, 12 + 4 + 12);
  assert.deepEqual(r.plans.map((p) => [p.label, p.count, p.bottles]), [['Vol.2', 16, 12], ['Vol.5', 1, 4], ['PRO', 16, 12]]);
});

test('「これからの1週間」は今日を起点に毎日ずれる。今日より前は past にまとめる', () => {
  const csv = ['次回配送予定日,定期回数',
    ...Array(8).fill('2026/10/06,1'),   // 10/5(月)出荷
    ...Array(7).fill('2026/10/10,1'),   // 10/9(金)出荷
    '2026/10/14,4',                     // 10/13(火)出荷
    '2026/10/17,4',                     // 土に届く → 10/16(金)出荷
  ].join('\n');
  const r = buildSchedule(rowsFromCsv(csv), { factor: 7.5, today: '2026-10-09' });
  assert.equal(r.today, '2026-10-09');
  assert.deepEqual(r.weeks.map((w) => [w.start, w.startWeekday, w.end, w.endWeekday, w.total]), [
    ['2026-10-09', '金', '2026-10-15', '木', 8],  // 10/9 の7件 + 10/13 の1件
    ['2026-10-16', '金', '2026-10-22', '木', 1],
  ]);
  assert.deepEqual(r.weeks[0].days.map((d) => d.date), ['2026-10-09', '2026-10-13']);
  assert.equal(r.past.total, 8);                  // 10/5 は過ぎている
  // 翌日になると起点がずれ、10/9 も past に入る
  const next = buildSchedule(rowsFromCsv(csv), { factor: 7.5, today: '2026-10-10' });
  assert.deepEqual(next.weeks.map((w) => [w.start, w.end, w.total]), [['2026-10-10', '2026-10-16', 2]]); // 10/13 と 10/16
  assert.equal(next.past.total, 15);
  // 出荷日がすべて過ぎていれば、これからの週は空
  const done = buildSchedule(rowsFromCsv(csv), { factor: 7.5, today: '2026-12-01' });
  assert.deepEqual(done.weeks, []);
  assert.equal(done.past.total, 17);
});

test('Vol.1 の見込みを月ごとの発注本数用に返す', () => {
  const r = buildSchedule(rowsFromCsv('次回配送予定日,定期回数\n2026/10/05,1\n'), { factor: 7.5, forecasts: { 'Vol.1': 130 } });
  assert.deepEqual(r.forecasts.map((p) => [p.label, p.count, p.perWine, p.bottles, p.forecast]), [['Vol.1', 130, 18, 72, true]]);
});

const { rowsFromExtra, countsByDelivery } = require('../lib/shipment-schedule');

test('連絡をもらった配送予定日の件数は、Vol を進めずにそのまま足す。レポートにある日は足さない', () => {
  const extra = { deliveries: {
    '2026-10-01': { 'Vol.3': 2, 'Vol.8': 3 },
    '2026-10-02': { 'Vol.12': 1 },
    '2026-10-06': { 'Vol.5': 9 }, // レポートにある日
  } };
  const report = rowsFromCsv('次回配送予定日,定期回数\n2026/10/06 0:00,4\n');
  const rows = report.concat(rowsFromExtra(extra, report));
  assert.deepEqual(countsByDelivery(rows), {
    '2026-10-01': { 'Vol.3': 2, 'Vol.8': 3 },
    '2026-10-02': { 'Vol.12': 1 },
    '2026-10-06': { 'Vol.5': 1 },
  });
  const r = buildSchedule(rows, { today: '2026-09-30' });
  assert.deepEqual(r.days.map((d) => [d.date, d.total, d.extra.map((e) => [e.date, e.count])]), [
    ['2026-09-30', 5, [['2026-10-01', 5]]],  // 10/1(木)着 → 9/30(水)出荷
    ['2026-10-01', 1, [['2026-10-02', 1]]],  // 10/2(金)着 → 10/1(木)出荷。Vol.12 のまま（PRO にしない）
    ['2026-10-05', 1, []],
  ]);
  assert.deepEqual(r.days[1].plans, [{ label: 'Vol.12', count: 1 }]);
});

test('連絡の 1回（Vol.1）は月の見込みで数えるので使わない', () => {
  const rows = rowsFromExtra({ deliveries: { '2026-10-01': { 'Vol.1': 3, 'Vol.2': 1 } } }, [], { skipPlans: ['Vol.1'] });
  assert.deepEqual(countsByDelivery(rows), { '2026-10-01': { 'Vol.2': 1 } });
});

test('月のカードの Vol.1 見込みは、今日から月末までの平日の分だけ入れる', () => {
  const csv = '次回配送予定日,定期回数\n2026/10/01,1\n2026/10/06,1\n';
  const r = buildSchedule(rowsFromCsv(csv), { factor: 7.5, today: '2026-09-30', forecasts: { 'Vol.1': 130 } });
  // 9月：9/30 の1日 / 9月の平日22日 → 130×1/22 = 5.9 → 6件 → 1銘柄1本。10月：まるごと
  assert.deepEqual(r.months.map((m) => [m.key, m.forecasts.map((p) => [p.label, p.count, p.perWine])]), [
    ['2026-09', [['Vol.1', 6, 1]]],
    ['2026-10', [['Vol.1', 130, 18]]],
  ]);
  // 10/1 になれば、出荷日がすべて過ぎた9月は出さない
  const next = buildSchedule(rowsFromCsv(csv), { factor: 7.5, today: '2026-10-01', forecasts: { 'Vol.1': 130 } });
  assert.deepEqual(next.months.map((m) => m.key), ['2026-10']);
});
