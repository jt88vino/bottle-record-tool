// 瓶詰め済みで、まだ出荷していない小瓶の数を見積もる（牛嶋さん指定：過去は遡らず、2026-09-29 の瓶詰めから数える）
//
// 在庫シートの「現在在庫」は、瓶詰めした本数をもう引いている。瓶詰めした分は小瓶になって出荷を待っているので、
// その小瓶も出荷に回せる。そこで、起点の日からの
//   瓶詰めした本数（「瓶詰め使用」の累計の増えた分）× 小瓶換算
// から、起点の日から昨日までの出荷件数（定期便1件で、そのプランの各銘柄を小瓶1本ずつ使う）を引いた数を、
// 瓶詰め済みの小瓶として数える。
// 起点より前に作ってあった小瓶は分からないので数えない（少なめに見積もる側に倒す）。

const { shipDateFor, parseDate, toKey } = require('./shipment-schedule');

const WEEKDAYS_PER_MONTH = 21.75; // 月あたりの平日の平均（見込みのプランの1日あたりの件数に使う）

function planOfWine(id) {
  const text = String(id || '').trim();
  const vol = text.match(/^vol\.?\s*(\d+)\s*-\s*\d+$/i);
  if (vol) return `Vol.${Number(vol[1])}`;
  if (/^pro\.?\s*\d+$/i.test(text)) return 'PRO';
  return null;
}

function isWeekday(key) {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day !== 0 && day !== 6;
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

// 配送予定日（お客様に届く日）からプランの出荷日を出す
function shipKey(deliveryKey, label) {
  return toKey(shipDateFor(parseDate(deliveryKey), label));
}

// 出荷件数を、配送予定日ごと・プランごとに台帳へ書き留める。書き足したら true
// 定期レポートは注文が出た分から消えていくので、見えているうちに先の日も控えておく。出荷日が起点より前の分は控えない。
// 同じ日を何度見ても、プランごとに多いほうの件数を残す（件数が減った日を多めに数えるので、小瓶は少なめに見積もる側に倒れる）
function recordShipments(ledger, deliveries, startDate) {
  let changed = false;
  if (ledger.days) { delete ledger.days; changed = true; } // 出荷日ごとに持っていた前の形は使わない
  ledger.deliveries = ledger.deliveries || {};
  Object.entries(deliveries).forEach(([date, plans]) => {
    const kept = ledger.deliveries[date] || {};
    Object.entries(plans).forEach(([label, count]) => {
      if (shipKey(date, label) < startDate || (kept[label] || 0) >= count) return;
      kept[label] = count;
      changed = true;
    });
    if (Object.keys(kept).length) ledger.deliveries[date] = kept;
  });
  return changed;
}

// 定期レポートの最初の配送予定日から4週間の、配送予定日1日あたりのプランごとの件数（PRO は27日にまとめて出すので除く）
function dailyAverages(reportDeliveries, spanDays = 28) {
  const dates = Object.keys(reportDeliveries).sort();
  if (!dates.length) return {};
  const end = addDays(dates[0], spanDays);
  const totals = {};
  dates.filter((date) => date < end).forEach((date) => {
    Object.entries(reportDeliveries[date]).forEach(([label, count]) => {
      if (label !== 'PRO') totals[label] = (totals[label] || 0) + count;
    });
  });
  return Object.fromEntries(Object.entries(totals).map(([label, total]) => [label, total / spanDays]));
}

// 起点の日〜昨日にプランごとに出荷した件数。見込みのプラン（Vol.1）は平日1日あたり 月の件数÷21.75 件。
// 定期レポートは注文が出た分から消えていく。レポートの最初の配送予定日より前で、台帳にも無い（連絡ももらっていない）
// 配送予定日は、出荷があったのに数えられないので、レポートの1日あたりの件数で見積もって足す。
// 出荷日が今日以降でも、レポートに無い日は「今後の必要」に入らないので、ここで小瓶から引いておく
function consumedByPlan(ledger, startDate, today, forecasts = {}, reportDeliveries = {}) {
  const totals = {};
  const add = (label, count) => { totals[label] = (totals[label] || 0) + count; };
  const kept = ledger.deliveries || {};
  Object.entries(kept).forEach(([date, plans]) => {
    Object.entries(plans).forEach(([label, count]) => {
      const ship = shipKey(date, label);
      if (ship >= startDate && ship < today) add(label, count);
    });
  });
  const first = Object.keys(reportDeliveries).sort()[0];
  const averages = dailyAverages(reportDeliveries);
  for (let date = startDate; first && date < first; date = addDays(date, 1)) {
    if (kept[date] || shipKey(date, 'Vol') < startDate) continue;
    Object.entries(averages).forEach(([label, perDay]) => add(label, perDay));
  }
  Object.entries(forecasts).forEach(([label, monthly]) => {
    if (totals[label]) return;
    let weekdays = 0;
    for (let key = startDate; key < today; key = addDays(key, 1)) if (isWeekday(key)) weekdays += 1;
    totals[label] = (monthly / WEEKDAYS_PER_MONTH) * weekdays;
  });
  return totals;
}

// 銘柄ごとの瓶詰め済みの小瓶の数
function smallBottlesOnHand(stockItems, baseline, factor, consumed) {
  const result = {};
  stockItems.forEach((item) => {
    // PRO は在庫シートの「瓶詰め使用」に瓶詰めが入らない（在庫も減らない）ので数えない
    if (planOfWine(item.id) === 'PRO') return;
    const start = baseline.bottledTotal ? baseline.bottledTotal[item.id] : undefined;
    if (start === undefined || item.bottled == null) return;
    const bottledSince = Math.max(0, item.bottled - start);
    const used = consumed[planOfWine(item.id)] || 0;
    const onHand = Math.floor(Math.max(0, bottledSince * factor - used) + 1e-9);
    if (onHand > 0) result[item.id] = onHand;
  });
  return result;
}

module.exports = { recordShipments, consumedByPlan, dailyAverages, smallBottlesOnHand, WEEKDAYS_PER_MONTH };
