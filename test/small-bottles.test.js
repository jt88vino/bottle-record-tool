const assert = require('node:assert/strict');
const test = require('node:test');
const { recordShipments, consumedByPlan, weekdayAverages, smallBottlesOnHand } = require('../lib/small-bottles');

const days = [
  { date: '2026-09-28', plans: [{ label: 'Vol.2', count: 99 }] }, // 起点より前は記録しない
  { date: '2026-09-29', plans: [{ label: 'Vol.2', count: 5 }, { label: 'PRO', count: 2 }] },
  { date: '2026-10-01', plans: [{ label: 'Vol.2', count: 3 }] },
  { date: '2026-10-02', plans: [{ label: 'Vol.2', count: 8 }] }, // 先の日も見えているうちに記録する
];

test('起点の日からの出荷を台帳に書き留め、同じ日はプランごとに多いほうを残す', () => {
  const ledger = { days: {} };
  assert.equal(recordShipments(ledger, days, '2026-09-29'), true);
  assert.deepEqual(ledger.days, {
    '2026-09-29': { 'Vol.2': 5, PRO: 2 },
    '2026-10-01': { 'Vol.2': 3 },
    '2026-10-02': { 'Vol.2': 8 },
  });
  // 同じレポートをもう一度読んでも変わらない
  assert.equal(recordShipments(ledger, days, '2026-09-29'), false);
  // レポートを貼り替えて済んだ日が消えたり、件数が減ったりしても、記録は残る
  assert.equal(recordShipments(ledger, [{ date: '2026-10-02', plans: [{ label: 'Vol.2', count: 6 }] }, { date: '2026-10-05', plans: [] }], '2026-09-29'), false);
  assert.deepEqual(Object.keys(ledger.days), ['2026-09-29', '2026-10-01', '2026-10-02']);
  assert.equal(ledger.days['2026-10-02']['Vol.2'], 8);
  // 件数が増えたら増えたほうにし、新しいプランは足す
  assert.equal(recordShipments(ledger, [{ date: '2026-10-02', plans: [{ label: 'Vol.2', count: 10 }, { label: 'Vol.4', count: 1 }] }], '2026-09-29'), true);
  assert.deepEqual(ledger.days['2026-10-02'], { 'Vol.2': 10, 'Vol.4': 1 });
});

test('起点の日〜昨日に出荷した件数をプランごとに合計する。見込みのプランは平日数で按分', () => {
  const ledger = { days: { '2026-09-30': { 'Vol.2': 5, PRO: 2 }, '2026-10-01': { 'Vol.2': 3 }, '2026-10-02': { 'Vol.2': 8 } } };
  const c = consumedByPlan(ledger, '2026-09-30', '2026-10-02', { 'Vol.1': 130 });
  assert.equal(c['Vol.2'], 8); // 今日（10/2）からの出荷はまだ使っていない
  assert.equal(c.PRO, 2);
  assert.ok(Math.abs(c['Vol.1'] - (130 / 21.75) * 2) < 1e-9); // 9/30(水)・10/1(木) の2平日
  // 今日が起点なら、まだ何も使っていない
  assert.deepEqual(consumedByPlan(ledger, '2026-09-30', '2026-09-30', { 'Vol.1': 130 }), { 'Vol.1': 0 });
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

test('定期レポートの最初の日から4週間の、平日1日あたりの件数（PRO は除く）', () => {
  const avg = weekdayAverages([
    { date: '2026-10-02', plans: [{ label: 'Vol.8', count: 20 }, { label: 'PRO', count: 900 }] },
    { date: '2026-10-05', plans: [{ label: 'Vol.8', count: 20 }] },
    { date: '2026-10-30', plans: [{ label: 'Vol.8', count: 999 }] }, // 4週間より先は入れない
  ]);
  assert.deepEqual(avg, { 'Vol.8': 40 / 20 }); // 10/2〜10/29 の平日は20日
});

test('レポートに載る前に済んだ出荷日（台帳にも無い平日）は、平日1日あたりの件数で見積もって引く', () => {
  const days = [
    { date: '2026-10-02', plans: [{ label: 'Vol.8', count: 20 }] },
    { date: '2026-10-05', plans: [{ label: 'Vol.8', count: 20 }] },
  ];
  const ledger = { days: {} };
  recordShipments(ledger, days, '2026-09-29');
  // 今日 9/30：9/29(火)・9/30(水)・10/1(木) はレポートにも台帳にも無い → 3日 × 2件。今日以降の 9/30・10/1 も「今後の必要」に入らないので引く
  assert.deepEqual(consumedByPlan(ledger, '2026-09-29', '2026-09-30', {}, days), { 'Vol.8': 6 });
  // 台帳に記録のある日は見積もらない
  ledger.days['2026-09-30'] = { 'Vol.8': 5 };
  assert.deepEqual(consumedByPlan(ledger, '2026-09-29', '2026-10-01', {}, days), { 'Vol.8': 5 + 2 * 2 });
  // 10/6 になれば 10/2・10/5 は台帳から数える
  assert.deepEqual(consumedByPlan(ledger, '2026-09-29', '2026-10-06', {}, days), { 'Vol.8': 5 + 2 * 2 + 40 });
});

test('9/29 に瓶詰めしたカヤ（vol.8-4）の30本は小瓶225本。そこから 9/29〜10/1 の出荷の見積もりを引く', () => {
  const baseline = require('../data/small-bottle-baseline.json');
  assert.equal(baseline.startDate, '2026-09-29');
  assert.equal(baseline.bottledTotal['vol.8-4'], 7); // 9/30朝の37本 − 9/29の30本
  assert.deepEqual(smallBottlesOnHand([{ id: 'vol.8-4', bottled: 37 }], baseline, 7.5, {}), { 'vol.8-4': 225 });
  assert.deepEqual(smallBottlesOnHand([{ id: 'vol.8-4', bottled: 37 }], baseline, 7.5, { 'Vol.8': 15.8 * 3 }), { 'vol.8-4': 177 });
});

test('PRO は在庫シートに瓶詰めが入らないので、小瓶を数えない', () => {
  assert.deepEqual(smallBottlesOnHand([{ id: 'Pro.1', bottled: 40 }], { bottledTotal: { 'Pro.1': 0 } }, 7.5, {}), {});
});
