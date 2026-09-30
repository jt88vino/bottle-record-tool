// 瓶詰め済みで、まだ出荷していない小瓶の数を見積もる（牛嶋さん指定：過去は遡らず、2026-09-29 の瓶詰めから数える）
//
// 在庫シートの「現在在庫」は、瓶詰めした本数をもう引いている。瓶詰めした分は小瓶になって出荷を待っているので、
// その小瓶も出荷に回せる。そこで、起点の日からの
//   瓶詰めした本数（「瓶詰め使用」の累計の増えた分）× 小瓶換算
// から、起点の日から昨日までの出荷件数（定期便1件で、そのプランの各銘柄を小瓶1本ずつ使う）を引いた数を、
// 瓶詰め済みの小瓶として数える。
// 起点より前に作ってあった小瓶は分からないので数えない（少なめに見積もる側に倒す）。

const { shipDateFor, parseDate, toKey, rowsFromCounts } = require('./shipment-schedule');

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

// 定期レポートの最初の配送予定日から4週間（レポートがそれより短ければその日数）の、
// 配送予定日1日あたりのプランごとの件数（PRO は27日にまとめて出すので除く）
function dailyAverages(reportDeliveries, spanDays = 28) {
  const dates = Object.keys(reportDeliveries).sort();
  if (!dates.length) return {};
  const end = addDays(dates[0], spanDays);
  const inSpan = dates.filter((date) => date < end);
  let covered = 0;
  for (let date = dates[0]; date <= inSpan[inSpan.length - 1]; date = addDays(date, 1)) covered += 1;
  const totals = {};
  inSpan.forEach((date) => {
    Object.entries(reportDeliveries[date]).forEach(([label, count]) => {
      if (label !== 'PRO') totals[label] = (totals[label] || 0) + count;
    });
  });
  return Object.fromEntries(Object.entries(totals).map(([label, total]) => [label, total / covered]));
}

// 定期レポートは注文が出た分から消えていく。レポートの最初の配送予定日より前で、これまでのどのレポートにも入って
// いなかった（連絡ももらっていない）配送予定日は、出荷があったのに数えられないので、レポートの1日あたりの件数
// （切り上げ）で見積もって台帳に控える。前のレポートに入っていて件数が0だった日は、本当に0件なので見積もらない。
// 一度控えた見積もりは、あとでレポートが変わっても動かさない（実数が分かれば deliveries のほうを使う）。控えたら true
function fillEstimates(ledger, reportDeliveries, startDate) {
  const dates = Object.keys(reportDeliveries).sort();
  if (!dates.length) return false;
  const [first, last] = [dates[0], dates[dates.length - 1]];
  ledger.deliveries = ledger.deliveries || {};
  ledger.estimates = ledger.estimates || {};
  const seen = ledger.seen || null;
  let averages = null;
  let changed = false;
  for (let date = startDate; date < first; date = addDays(date, 1)) {
    if (seen && date >= seen.from && date <= seen.to) continue;
    if (ledger.deliveries[date] || ledger.estimates[date] || shipKey(date, 'Vol') < startDate) continue;
    averages = averages || dailyAverages(reportDeliveries);
    const plans = Object.fromEntries(Object.entries(averages)
      .map(([label, perDay]) => [label, Math.ceil(perDay - 1e-9)])
      .filter(([, count]) => count > 0));
    if (!Object.keys(plans).length) continue;
    ledger.estimates[date] = plans;
    changed = true;
  }
  // これまでのレポートが入れていた配送予定日の範囲
  const from = seen && seen.from < first ? seen.from : first;
  const to = seen && seen.to > last ? seen.to : last;
  if (!seen || seen.from !== from || seen.to !== to) {
    ledger.seen = { from, to };
    changed = true;
  }
  return changed;
}

// 台帳の配送予定日ごとの件数。実数（deliveries）があればそれを、なければ見積もり（estimates）を使う
function ledgerEntries(ledger) {
  const deliveries = ledger.deliveries || {};
  const estimates = ledger.estimates || {};
  return [
    ...Object.entries(deliveries).map(([date, plans]) => ({ date, plans, source: 'ledger' })),
    ...Object.entries(estimates).filter(([date]) => !deliveries[date]).map(([date, plans]) => ({ date, plans, source: 'estimate' })),
  ];
}

// 台帳にあって、いまの定期レポート・連絡の数に無い配送予定日のうち、出荷がまだ先（今日以降）の分を行にする。
// 注文が出てレポートから消えても、出荷するまでは「今後の必要」に入れておく
function rowsFromLedger(ledger, knownRows, today) {
  const known = new Set(knownRows.map((row) => parseDate(row.deliveryDate)).filter(Boolean).map(toKey));
  const rows = [];
  ledgerEntries(ledger).forEach(({ date, plans, source }) => {
    rows.push(...rowsFromCounts({ [date]: plans }, { source, skipDates: known, keep: (key, label) => shipKey(key, label) >= today }));
  });
  return rows;
}

// 出荷日が起点の日〜昨日の件数をプランごとに合計する（台帳の実数と見積もり）。
// 出荷日が今日以降の分は「今後の必要」のほうに入るので、ここでは数えない。
// 見込みのプラン（Vol.1）は平日1日あたり 月の件数÷21.75 件
function consumedByPlan(ledger, startDate, today, forecasts = {}) {
  const totals = {};
  ledgerEntries(ledger).forEach(({ date, plans }) => {
    Object.entries(plans).forEach(([label, count]) => {
      const ship = shipKey(date, label);
      if (ship >= startDate && ship < today) totals[label] = (totals[label] || 0) + count;
    });
  });
  Object.entries(forecasts).forEach(([label, monthly]) => {
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

module.exports = { recordShipments, fillEstimates, rowsFromLedger, consumedByPlan, dailyAverages, smallBottlesOnHand, WEEKDAYS_PER_MONTH };
