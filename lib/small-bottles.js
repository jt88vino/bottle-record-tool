// 瓶詰め済みで、まだ出荷していない小瓶の数を見積もる（2026-09-30 牛嶋さん指定：過去は遡らず、この日から数える）
//
// 在庫シートの「現在在庫」は、瓶詰めした本数をもう引いている。瓶詰めした分は小瓶になって出荷を待っているので、
// その小瓶も出荷に回せる。そこで、起点の日からの
//   瓶詰めした本数（「瓶詰め使用」の累計の増えた分）× 小瓶換算
// から、起点の日から昨日までの出荷件数（定期便1件で、そのプランの各銘柄を小瓶1本ずつ使う）を引いた数を、
// 瓶詰め済みの小瓶として数える。
// 起点より前に作ってあった小瓶は分からないので数えない（少なめに見積もる側に倒す）。

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

// 起点の日〜昨日の出荷を、まだ書き留めていない日だけ台帳に足す。書き足したら true
function recordPastDays(ledger, days, startDate, today) {
  let changed = false;
  days.forEach((day) => {
    if (day.date < startDate || day.date >= today || ledger.days[day.date]) return;
    ledger.days[day.date] = Object.fromEntries(day.plans.map((p) => [p.label, p.count]));
    changed = true;
  });
  return changed;
}

// 起点の日〜昨日にプランごとに出荷した件数。見込みのプラン（Vol.1）は平日1日あたり 月の件数÷21.75 件
function consumedByPlan(ledger, startDate, today, forecasts = {}) {
  const totals = {};
  Object.entries(ledger.days || {}).forEach(([date, plans]) => {
    if (date < startDate || date >= today) return;
    Object.entries(plans).forEach(([label, count]) => { totals[label] = (totals[label] || 0) + count; });
  });
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
    const start = baseline.bottledTotal ? baseline.bottledTotal[item.id] : undefined;
    if (start === undefined || item.bottled == null) return;
    const bottledSince = Math.max(0, item.bottled - start);
    const used = consumed[planOfWine(item.id)] || 0;
    const onHand = Math.floor(Math.max(0, bottledSince * factor - used) + 1e-9);
    if (onHand > 0) result[item.id] = onHand;
  });
  return result;
}

module.exports = { recordPastDays, consumedByPlan, smallBottlesOnHand, WEEKDAYS_PER_MONTH };
