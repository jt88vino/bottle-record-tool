const assert = require('node:assert/strict');
const test = require('node:test');
const { recordPastDays, consumedByPlan, smallBottlesOnHand } = require('../lib/small-bottles');

const days = [
  { date: '2026-09-29', plans: [{ label: 'Vol.2', count: 99 }] }, // 起点より前は記録しない
  { date: '2026-09-30', plans: [{ label: 'Vol.2', count: 5 }, { label: 'PRO', count: 2 }] },
  { date: '2026-10-01', plans: [{ label: 'Vol.2', count: 3 }] },
  { date: '2026-10-02', plans: [{ label: 'Vol.2', count: 8 }] }, // 今日以降も記録しない
];

test('起点の日〜昨日の出荷だけを台帳に書き留め、書き留めた日は上書きしない', () => {
  const ledger = { days: {} };
  assert.equal(recordPastDays(ledger, days, '2026-09-30', '2026-10-02'), true);
  assert.deepEqual(ledger.days, { '2026-09-30': { 'Vol.2': 5, PRO: 2 }, '2026-10-01': { 'Vol.2': 3 } });
  // レポートを貼り替えて過ぎた日が消えても、台帳の記録は残る
  assert.equal(recordPastDays(ledger, [{ date: '2026-10-05', plans: [] }], '2026-09-30', '2026-10-02'), false);
  assert.deepEqual(Object.keys(ledger.days), ['2026-09-30', '2026-10-01']);
  // 同じ日をもう一度記録しない
  assert.equal(recordPastDays(ledger, days, '2026-09-30', '2026-10-02'), false);
});

test('起点の日〜昨日に出荷した件数をプランごとに合計する。見込みのプランは平日数で按分', () => {
  const ledger = { days: { '2026-09-30': { 'Vol.2': 5, PRO: 2 }, '2026-10-01': { 'Vol.2': 3 } } };
  const c = consumedByPlan(ledger, '2026-09-30', '2026-10-02', { 'Vol.1': 130 });
  assert.equal(c['Vol.2'], 8);
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
