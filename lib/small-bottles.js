// 瓶詰め済みで、まだ出荷していない小瓶の数を見積もる（牛嶋さん指定：過去は遡らず、2026-09-29 の瓶詰めから数える）
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

// 起点の日からの出荷予定を、日ごと・プランごとに台帳へ書き留める。書き足したら true
// 定期レポートは出荷の済んだ日から消えていくので、過ぎた日だけでなく先の日も見えているうちに控えておく。
// 同じ日を何度見ても、プランごとに多いほうの件数を残す（件数が減った日を多めに数えるので、小瓶は少なめに見積もる側に倒れる）
function recordShipments(ledger, days, startDate) {
  let changed = false;
  days.forEach((day) => {
    if (day.date < startDate) return;
    const kept = ledger.days[day.date] || {};
    day.plans.forEach((plan) => {
      if ((kept[plan.label] || 0) >= plan.count) return;
      kept[plan.label] = plan.count;
      changed = true;
    });
    if (Object.keys(kept).length) ledger.days[day.date] = kept;
  });
  return changed;
}

// 定期レポートの最初の日から4週間の、平日1日あたりのプランごとの件数（PRO は27日にまとめて出すので除く）
function weekdayAverages(days, spanDays = 28) {
  if (!days.length) return {};
  const first = days.reduce((min, day) => (day.date < min ? day.date : min), days[0].date);
  const end = addDays(first, spanDays);
  let weekdays = 0;
  for (let key = first; key < end; key = addDays(key, 1)) if (isWeekday(key)) weekdays += 1;
  const totals = {};
  days.forEach((day) => {
    if (day.date >= end) return;
    day.plans.forEach((plan) => {
      if (plan.label !== 'PRO') totals[plan.label] = (totals[plan.label] || 0) + plan.count;
    });
  });
  return Object.fromEntries(Object.entries(totals).map(([label, total]) => [label, total / weekdays]));
}

// 起点の日〜昨日にプランごとに出荷した件数。見込みのプラン（Vol.1）は平日1日あたり 月の件数÷21.75 件。
// 定期レポートは、注文が出た分から消えていく。レポートの最初の日より前で台帳にも無い平日は、出荷があったのに
// 数えられないので、レポートの平日1日あたりの件数で見積もって足す（今日以降でも、レポートに無い日は「今後の必要」に
// 入らないので、ここで小瓶から引いておく）
function consumedByPlan(ledger, startDate, today, forecasts = {}, days = []) {
  const totals = {};
  const add = (label, count) => { totals[label] = (totals[label] || 0) + count; };
  Object.entries(ledger.days || {}).forEach(([date, plans]) => {
    if (date < startDate || date >= today) return;
    Object.entries(plans).forEach(([label, count]) => add(label, count));
  });
  const firstReported = days.reduce((min, day) => (!min || day.date < min ? day.date : min), null);
  const averages = weekdayAverages(days);
  for (let key = startDate; firstReported && key < firstReported; key = addDays(key, 1)) {
    if (!isWeekday(key) || (ledger.days || {})[key]) continue;
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

module.exports = { recordShipments, consumedByPlan, weekdayAverages, smallBottlesOnHand, WEEKDAYS_PER_MONTH };
