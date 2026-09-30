const assert = require('node:assert/strict');
const test = require('node:test');
const { recordShipments, consumedByPlan, dailyAverages, smallBottlesOnHand } = require('../lib/small-bottles');

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
    '2026-10-05': { 'Vol.8': 36 },
    '2026-11-01': { 'Vol.8': 999 }, // 4週間より先は入れない
  });
  assert.deepEqual(avg, { 'Vol.8': 56 / 28 });
});

test('レポートにも台帳にも無い配送予定日は、1日あたりの件数で見積もって引く。連絡をもらった日は実数を使う', () => {
  const report = { '2026-10-04': { 'Vol.8': 28 }, '2026-10-05': { 'Vol.8': 28 } }; // 1日あたり 56/28 = 2件
  const ledger = { deliveries: {} };
  recordShipments(ledger, { ...report, '2026-10-01': { 'Vol.8': 75 }, '2026-10-02': { 'Vol.8': 54 } }, '2026-09-29');
  // 今日 9/30：連絡の 10/1着(9/30出荷)・10/2着(10/1出荷) は「今後の必要」に入るのでまだ引かない。
  // 9/30着(9/29出荷)・10/3着(10/2出荷) はどこにも無い → 2日 × 2件。9/29着は 9/28 出荷なので起点より前
  assert.deepEqual(consumedByPlan(ledger, '2026-09-29', '2026-09-30', {}, report), { 'Vol.8': 4 });
  // 10/2 になれば、連絡の2日分は済んだ出荷として実数で引く
  assert.deepEqual(consumedByPlan(ledger, '2026-09-29', '2026-10-02', {}, report), { 'Vol.8': 4 + 75 + 54 });
  // レポートが先に進んでも、台帳に控えた日は見積もらない（10/4着・10/5着は 10/2 出荷の実数）
  assert.deepEqual(consumedByPlan(ledger, '2026-09-29', '2026-10-05', {}, { '2026-10-10': { 'Vol.8': 56 } }), { 'Vol.8': 4 + 75 + 54 + 56 + 2 * 4 });
});

test('9/29 に瓶詰めしたカヤ（vol.8-4）の30本は小瓶225本。そこから出荷した分を引く', () => {
  const baseline = require('../data/small-bottle-baseline.json');
  assert.equal(baseline.startDate, '2026-09-29');
  assert.equal(baseline.bottledTotal['vol.8-4'], 7); // 9/30朝の37本 − 9/29の30本
  assert.deepEqual(smallBottlesOnHand([{ id: 'vol.8-4', bottled: 37 }], baseline, 7.5, {}), { 'vol.8-4': 225 });
  assert.deepEqual(smallBottlesOnHand([{ id: 'vol.8-4', bottled: 37 }], baseline, 7.5, { 'Vol.8': 75 + 54 }), { 'vol.8-4': 96 });
});

test('PRO は在庫シートに瓶詰めが入らないので、小瓶を数えない', () => {
  assert.deepEqual(smallBottlesOnHand([{ id: 'Pro.1', bottled: 40 }], { bottledTotal: { 'Pro.1': 0 } }, 7.5, {}), {});
});
