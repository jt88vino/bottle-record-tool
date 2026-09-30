const assert = require('node:assert/strict');
const test = require('node:test');
const { recordShipments, fillEstimates, rowsFromLedger, consumedByPlan, dailyAverages, smallBottlesOnHand } = require('../lib/small-bottles');
const { buildSchedule, rowsFromCsv } = require('../lib/shipment-schedule');

// 配送予定日（お客様に届く日）ごとの件数。Vol は前日（土日なら金曜）、PRO は27日に出荷
const deliveries = {
  '2026-09-29': { 'Vol.2': 99 },           // 9/28(月)出荷：起点より前なので控えない
  '2026-09-30': { 'Vol.2': 5 },            // 9/29(火)出荷
  '2026-10-02': { 'Vol.2': 3 },            // 10/1(木)出荷
  '2026-10-05': { 'Vol.2': 8, PRO: 2 },    // Vol は 10/2(金)、PRO は 10/27(火)出荷。先の日も控える
};

test('配送予定日ごとの出荷件数を台帳に書き留め、同じ日はプランごとに多いほうを残す', () => {
  const ledger = { days: { '2026-10-02': { 'Vol.2': 1 } } }; // 前の形（出荷日ごと）は消す
  assert.equal(recordShipments(ledger, deliveries, '2026-09-29'), true);
  assert.equal(ledger.days, undefined);
  assert.deepEqual(ledger.deliveries, {
    '2026-09-30': { 'Vol.2': 5 },
    '2026-10-02': { 'Vol.2': 3 },
    '2026-10-05': { 'Vol.2': 8, PRO: 2 },
  });
  // 同じものをもう一度読んでも変わらない
  assert.equal(recordShipments(ledger, deliveries, '2026-09-29'), false);
  // レポートを貼り替えて済んだ日が消えたり、件数が減ったりしても、記録は残る
  assert.equal(recordShipments(ledger, { '2026-10-05': { 'Vol.2': 6 } }, '2026-09-29'), false);
  assert.equal(ledger.deliveries['2026-10-05']['Vol.2'], 8);
  assert.ok(ledger.deliveries['2026-09-30']);
  // 件数が増えたら増えたほうにし、新しいプランは足す
  assert.equal(recordShipments(ledger, { '2026-10-05': { 'Vol.2': 10, 'Vol.4': 1 } }, '2026-09-29'), true);
  assert.deepEqual(ledger.deliveries['2026-10-05'], { 'Vol.2': 10, 'Vol.4': 1, PRO: 2 });
});

test('出荷日が起点〜昨日の件数をプランごとに合計する。見込みのプランは平日数で按分', () => {
  const ledger = { deliveries: {} };
  recordShipments(ledger, deliveries, '2026-09-29');
  // 今日 10/2：9/29 と 10/1 の出荷は済み、10/2 の出荷と PRO はまだ
  const c = consumedByPlan(ledger, '2026-09-29', '2026-10-02', { 'Vol.1': 130 });
  assert.equal(c['Vol.2'], 5 + 3);
  assert.equal(c.PRO, undefined);
  assert.ok(Math.abs(c['Vol.1'] - (130 / 21.75) * 3) < 1e-9); // 9/29(火)・9/30(水)・10/1(木) の3平日
  // 今日が起点なら、まだ何も使っていない
  assert.deepEqual(consumedByPlan(ledger, '2026-09-29', '2026-09-29', { 'Vol.1': 130 }), { 'Vol.1': 0 });
  // 10/28 には PRO(10/27出荷) も済んでいる
  assert.equal(consumedByPlan(ledger, '2026-09-29', '2026-10-28').PRO, 2);
});

test('起点からの瓶詰め本数×7.5 − 使った件数 を、銘柄ごとの瓶詰め済みの小瓶とする', () => {
  const baseline = { bottledTotal: { 'vol.2-1': 22, 'vol.2-2': 22, 'vol.3-1': 11, 'Pro.1': 0 } };
  const stockItems = [
    { id: 'vol.2-1', bottled: 24 },   // 2本瓶詰め → 15本、使った 8件 → 7本
    { id: 'vol.2-2', bottled: 22 },   // 瓶詰めなし → 0
    { id: 'vol.3-1', bottled: 12 },   // 1本 → 7.5本（端数は切り捨てて7本）、使った 0件
    { id: 'Pro.1', bottled: 0 },      // 瓶詰めの記録が在庫に入っていない
    { id: 'vol.4-1', bottled: 5 },    // 起点に無い銘柄は数えない
  ];
  const onHand = smallBottlesOnHand(stockItems, baseline, 7.5, { 'Vol.2': 8, PRO: 2 });
  assert.deepEqual(onHand, { 'vol.2-1': 7, 'vol.3-1': 7 });
  // 使った件数のほうが多ければ 0（起点より前の小瓶は分からないので、少なめに見積もる）
  assert.deepEqual(smallBottlesOnHand([{ id: 'vol.2-1', bottled: 23 }], baseline, 7.5, { 'Vol.2': 20 }), {});
});

test('定期レポートの最初の配送予定日から4週間の、1日あたりの件数（PRO は除く）', () => {
  const avg = dailyAverages({
    '2026-10-04': { 'Vol.8': 20, PRO: 900 },
    '2026-10-31': { 'Vol.8': 36 },
    '2026-11-01': { 'Vol.8': 999 }, // 4週間より先は入れない
  });
  assert.deepEqual(avg, { 'Vol.8': 56 / 28 });
  // レポートが4週間より短ければ、その日数で割る
  assert.deepEqual(dailyAverages({ '2026-10-24': { 'Vol.8': 40 }, '2026-10-31': { 'Vol.8': 24 } }), { 'Vol.8': 64 / 8 });
});

test('レポートにも台帳にも無い配送予定日は、1日あたりの件数（切り上げ）で見積もって控え、あとで動かさない', () => {
  const report = { '2026-10-04': { 'Vol.8': 28, 'Vol.9': 1, PRO: 50 }, '2026-10-31': { 'Vol.8': 28 } }; // Vol.8 2件/日、Vol.9 1/28 → 1件
  const ledger = { deliveries: {} };
  recordShipments(ledger, { ...report, '2026-10-01': { 'Vol.8': 75 }, '2026-10-02': { 'Vol.8': 54 } }, '2026-09-29');
  assert.equal(fillEstimates(ledger, report, '2026-09-29'), true);
  // 9/29着は 9/28 出荷で起点より前。10/1着・10/2着は連絡の実数がある。9/30着・10/3着を見積もる
  assert.deepEqual(ledger.estimates, { '2026-09-30': { 'Vol.8': 2, 'Vol.9': 1 }, '2026-10-03': { 'Vol.8': 2, 'Vol.9': 1 } });
  // レポートが変わっても、一度控えた見積もりは動かない
  assert.equal(fillEstimates(ledger, { '2026-10-10': { 'Vol.8': 140 }, '2026-11-06': { 'Vol.8': 140 } }, '2026-09-29'), true);
  assert.deepEqual(ledger.estimates['2026-09-30'], { 'Vol.8': 2, 'Vol.9': 1 });
  // 前のレポートが入れていた 10/4〜10/31 は、件数が無くても本当に0件なので見積もらない
  assert.deepEqual(Object.keys(ledger.estimates), ['2026-09-30', '2026-10-03']);
  assert.deepEqual(ledger.seen, { from: '2026-10-04', to: '2026-11-06' });
  // レポートが飛んで、どのレポートにも入っていなかった日ができたら見積もる
  assert.equal(fillEstimates(ledger, { '2026-11-10': { 'Vol.8': 140 }, '2026-12-07': { 'Vol.8': 140 } }, '2026-09-29'), true);
  assert.deepEqual(Object.keys(ledger.estimates).slice(2), ['2026-11-07', '2026-11-08', '2026-11-09']);
  assert.deepEqual(ledger.estimates['2026-11-07'], { 'Vol.8': 10 });
});

test('出荷日が昨日までの分は小瓶から引き、今日以降の分は「今後の必要」に入れる（二重に数えない）', () => {
  const report = { '2026-10-04': { 'Vol.8': 28 }, '2026-10-31': { 'Vol.8': 28 } };
  const ledger = { deliveries: {} };
  recordShipments(ledger, { ...report, '2026-10-01': { 'Vol.8': 75 }, '2026-10-02': { 'Vol.8': 54 } }, '2026-09-29');
  fillEstimates(ledger, report, '2026-09-29');
  // 今日 9/30：済んだのは 9/30着の見積もり（9/29出荷）だけ
  assert.equal(consumedByPlan(ledger, '2026-09-29', '2026-09-30')['Vol.8'], 2);
  // 10/3 に、10/4着・10/5着が注文済みでレポートから消えた（10/2出荷は済み、ほかはまだ）
  const reportRows = rowsFromCsv('次回配送予定日,定期回数\n2026/10/31,7\n');
  const pending = rowsFromLedger(ledger, reportRows, '2026-10-05');
  // 10/4着（10/2出荷）は済み。10/5着 は無い日なので見積もり分は無し。10/31 はレポートにあるので足さない
  assert.deepEqual(pending, []);
  const pending2 = rowsFromLedger(ledger, reportRows, '2026-10-02');
  // 10/4着 28件（10/2出荷）がレポートから消えても、今後の出荷に残る。10/3着の見積もり2件（10/2出荷）も入る
  assert.equal(pending2.filter((row) => row.source === 'ledger' && row.count === '7').length, 28);
  assert.equal(pending2.filter((row) => row.source === 'estimate' && row.count === '7').length, 2);
  assert.equal(pending2.length, 30);
  const schedule = buildSchedule(reportRows.concat(pending2), { today: '2026-10-02' });
  assert.deepEqual(schedule.days[0].fromLedger, [{ date: '2026-10-04', weekday: '日', count: 28 }]);
  assert.deepEqual(schedule.days[0].estimated, [{ date: '2026-10-03', weekday: '土', count: 2 }]);
  // 同じ日に、小瓶から引くのは出荷日が昨日までの分だけ（9/29〜10/1 出荷：見積もり2＋75＋54）
  assert.equal(consumedByPlan(ledger, '2026-09-29', '2026-10-02')['Vol.8'], 2 + 75 + 54);
});

test('出荷がまだ先の見積もりは、今後の出荷に入れる（PRO の実数も27日まで残す）', () => {
  const ledger = { deliveries: { '2026-10-05': { 'Vol.8': 3, PRO: 4 } }, estimates: { '2026-10-06': { 'Vol.8': 2 } } };
  const rows = rowsFromLedger(ledger, [], '2026-10-06');
  // 10/5着 Vol.8 は 10/2 出荷で済み。PRO は 10/27 出荷なので残る。10/6着の見積もりは 10/5 出荷で済み
  assert.deepEqual(rows.map((row) => [row.deliveryDate, row.count, row.source]), Array(4).fill(['2026-10-05', '12', 'ledger']));
  const rows2 = rowsFromLedger(ledger, [], '2026-10-05');
  assert.equal(rows2.filter((row) => row.source === 'estimate').length, 2);
});

test('9/29 に瓶詰めしたカヤ（vol.8-4）の30本は小瓶225本。そこから出荷した分を引く', () => {
  const baseline = require('../data/small-bottle-baseline.json');
  assert.equal(baseline.startDate, '2026-09-29');
  assert.equal(baseline.bottledTotal['vol.8-4'], 7); // 9/30朝の37本 − 9/29の30本
  assert.deepEqual(smallBottlesOnHand([{ id: 'vol.8-4', bottled: 37 }], baseline, 7.5, {}), { 'vol.8-4': 225 });
  assert.deepEqual(smallBottlesOnHand([{ id: 'vol.8-4', bottled: 37 }], baseline, 7.5, { 'Vol.8': 12 }), { 'vol.8-4': 213 }); // 9/30着の見積もり12件
});

test('PRO は在庫シートに瓶詰めが入らないので、小瓶を数えない', () => {
  assert.deepEqual(smallBottlesOnHand([{ id: 'Pro.1', bottled: 40 }], { bottledTotal: { 'Pro.1': 0 } }, 7.5, {}), {});
});
