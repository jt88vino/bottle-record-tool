// ワインの現在庫と今後の出荷予定を突き合わせて、発注が必要な銘柄を洗い出す。
//
// 考え方（2026-09-29 牛嶋さん指定）
// - 定期便1件で、そのプランの各銘柄を小瓶1本ずつ使う。ワイン1本 = 小瓶 factor 本（既定 7.5）
// - 発注してから届くまで leadDays 日（既定 2日）
// - 在庫が lowStock 本（既定 6本）以下なら、出荷予定に関係なく知らせる（知らせるだけで、発注の本数には足さない）
// - 発注の本数は、出荷に必要な最小限（在庫を残す分は足さない。サブスクの件数は前後するため）
// - 出荷日当日にワインがあっても瓶詰めが間に合わないので、Vol は出荷日の arriveDaysBefore 日前（既定 7日＝1週間前）、
//   PRO は proArriveDaysBefore 日前（既定 14日＝2週間前）までに必ず届いている必要がある
// - 定期レポートに出てこないプラン（Vol.1 など）は、forecasts に月あたりの件数を渡すと、
//   今日から30日間の平日に均等にならした見込みで判定する（Vol.1 は月平均130件）
//
// 在庫が尽きる日 = 今後の出荷を日付順に足していき、いまの在庫でまかなえる小瓶の数を超える最初の出荷日
// 到着期限     = Vol は尽きる日の1週間前、PRO は2週間前（土日なら直前の金曜日）
// 発注期限     = 到着期限から leadDays 日さかのぼった日（土日なら直前の金曜日）
//
// 判定（上ほど重い）
//   urgent … 発注期限が明日まで（過ぎていれば、発注しても間に合わない可能性がある）
//   soon   … 発注期限が1週間以内
//   later  … 今後の出荷予定の分に足りないが、発注期限はまだ先
//   low    … 足りてはいるが、在庫が lowStock 本以下
//   ok     … 問題なし
//
// 日付はすべて YYYY-MM-DD の文字列で扱う（UTC の暦日）。

const { parseCsv } = require('./shipment-schedule');

const DEFAULT_LEAD_DAYS = 2;
const DEFAULT_LOW_STOCK = 6;
const DEFAULT_ARRIVE_DAYS_BEFORE = 7;
const DEFAULT_PRO_ARRIVE_DAYS_BEFORE = 14;
const FORECAST_WINDOW_DAYS = 30;

// 月あたり monthly 件を、今日から30日間の平日に均等に割り振った出荷の見込み
function forecastSeries(today, monthly) {
  const weekdays = [];
  for (let i = 0; i < FORECAST_WINDOW_DAYS; i += 1) {
    const key = addDays(today, i);
    const day = toDate(key).getUTCDay();
    if (day !== 0 && day !== 6) weekdays.push(key);
  }
  const perDay = monthly / weekdays.length;
  return weekdays.map((date) => ({ date, count: perDay }));
}
const LEVEL_ORDER = { urgent: 0, soon: 1, later: 2, low: 3, ok: 4 };
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function toDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toKey(date) {
  return date.toISOString().slice(0, 10);
}
function addDays(key, days) {
  return toKey(new Date(toDate(key).getTime() + days * 86400000));
}
// 土日なら直前の金曜日へ（発注も平日に行う前提）
function toWeekday(key) {
  const day = toDate(key).getUTCDay();
  if (day === 6) return addDays(key, -1);
  if (day === 0) return addDays(key, -2);
  return key;
}
function weekday(key) {
  return WEEKDAYS[toDate(key).getUTCDay()];
}
// Vol の出荷日に出す分の、いちばん遅い配送予定日（金曜の出荷は土・日・月に届く分も含む）
function lastDeliveryFor(shipDate) {
  return addDays(shipDate, toDate(shipDate).getUTCDay() === 5 ? 3 : 1);
}

// 'vol.2-1' → 'Vol.2'、'Pro.3' → 'PRO'
function planOfWine(id) {
  const text = String(id || '').trim();
  const vol = text.match(/^vol\.?\s*(\d+)\s*-\s*\d+$/i);
  if (vol) return `Vol.${Number(vol[1])}`;
  if (/^pro\.?\s*\d+$/i.test(text)) return 'PRO';
  return null;
}

// "6本" "¥9,600" "-1" などから数値を取り出す。取れなければ null
function toNumber(value) {
  const text = String(value == null ? '' : value).replace(/[,，\s円¥￥本]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

// 在庫タブ（プログラム / ワイン名 / … / 現在在庫 / 仕入価格…）を読む。見出しの位置は名前で探す
function stockFromCsv(text) {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row.some((c) => c.trim() === 'プログラム') && row.some((c) => c.trim().startsWith('現在在庫')));
  if (headerIndex < 0) throw new Error('在庫タブに「プログラム」と「現在在庫」の見出しが見つかりません。');
  const header = rows[headerIndex].map((c) => c.trim());
  const col = {
    id: header.indexOf('プログラム'),
    name: header.indexOf('ワイン名'),
    stock: header.findIndex((c) => c.startsWith('現在在庫')),
    price: header.findIndex((c) => c.startsWith('仕入価格')),
    bottled: header.indexOf('瓶詰め使用'),
  };
  const items = [];
  rows.slice(headerIndex + 1).forEach((cells) => {
    const id = String(cells[col.id] || '').trim();
    if (!planOfWine(id)) return;
    const stock = toNumber(cells[col.stock]);
    if (stock == null) return;
    const name = col.name >= 0 ? String(cells[col.name] || '').trim() : '';
    items.push({
      id,
      name: /未設定/.test(name) ? '' : name,
      stock,
      price: col.price >= 0 ? toNumber(cells[col.price]) : null,
      // 瓶詰めに使った本数の累計（瓶詰め済みの小瓶を数えるのに使う）
      bottled: col.bottled >= 0 ? toNumber(cells[col.bottled]) : null,
    });
  });
  return items;
}

// days: buildSchedule の days（date, plans:[{label,count}]）
// stock: stockFromCsv の結果
function buildStockAlerts(days, stock, options = {}) {
  const factor = Number(options.factor) > 0 ? Number(options.factor) : 7.5;
  const leadDays = Number.isInteger(options.leadDays) ? options.leadDays : DEFAULT_LEAD_DAYS;
  const lowStock = Number.isFinite(options.lowStock) ? options.lowStock : DEFAULT_LOW_STOCK;
  const arriveDaysBefore = Number.isInteger(options.arriveDaysBefore) ? options.arriveDaysBefore : DEFAULT_ARRIVE_DAYS_BEFORE;
  const proArriveDaysBefore = Number.isInteger(options.proArriveDaysBefore) ? options.proArriveDaysBefore : DEFAULT_PRO_ARRIVE_DAYS_BEFORE;
  const today = options.today;

  // プランごとの今後の出荷（日付順）
  const upcoming = days.filter((day) => !today || day.date >= today);
  const byPlan = {};
  upcoming.forEach((day) => day.plans.forEach((plan) => {
    (byPlan[plan.label] = byPlan[plan.label] || []).push({ date: day.date, count: plan.count });
  }));
  const lastDate = upcoming.length ? upcoming[upcoming.length - 1].date : null;
  const forecasts = options.forecasts || {};
  Object.keys(forecasts).forEach((plan) => {
    if (!byPlan[plan] && today && forecasts[plan] > 0) byPlan[plan] = forecastSeries(today, forecasts[plan]);
  });

  const items = stock.map((wine) => {
    const plan = planOfWine(wine.id);
    const series = byPlan[plan] || [];
    const isForecast = Boolean(forecasts[plan]) && series.length > 0 && !upcoming.some((day) => day.plans.some((p) => p.label === plan));
    const shipments = isForecast ? forecasts[plan] : series.reduce((sum, s) => sum + s.count, 0);
    // 瓶詰め済みでまだ出荷していない小瓶（lib/small-bottles.js で見積もる）。ワインを開けずにそのまま出荷に回せる
    const smallBottles = Math.max(0, Number((options.smallBottles || {})[wine.id]) || 0);
    const need = shipments ? Math.max(0, Math.ceil((shipments - smallBottles) / factor - 1e-9)) : 0;
    const available = Math.max(wine.stock, 0);
    const capacity = available * factor + smallBottles; // いまの在庫と瓶詰め済みの小瓶でまかなえる件数

    // 在庫が尽きる出荷日（累計がまかなえる小瓶数を超える最初の日）
    let running = 0;
    let runsOutOn = null;
    for (const s of series) {
      running += s.count;
      if (running > capacity + 1e-9) { runsOutOn = s.date; break; }
    }
    // いつまでに届いている必要があるか。Vol は出荷日の1週間前、PRO は2週間前
    const daysBefore = plan === 'PRO' ? proArriveDaysBefore : arriveDaysBefore;
    const arriveBy = runsOutOn ? toWeekday(addDays(runsOutOn, -daysBefore)) : null;
    // 届くまで leadDays 日かかるので、その分さかのぼった平日が発注期限
    const orderBy = arriveBy ? toWeekday(addDays(arriveBy, -leadDays)) : null;
    const shortage = Math.max(0, need - available);

    // 発注は最小限にする（サブスクの件数は前後するため）。足りない本数を、配送日から逆算して
    //   至急 … 発注期限が明日までの出荷分（いま発注しないと間に合わない分）だけ
    //   月ごと … それ以外を出荷日の月ごとに。月の分は至急に入れず、その分の発注期限までに発注すればよい
    // に分ける。切り上げは累計で行うので、至急と月ごとを足すと「不足」と一致する
    const deadlineOf = (shipDate) => toWeekday(addDays(toWeekday(addDays(shipDate, -daysBefore)), -leadDays));
    const bottlesFor = (cumulative) => Math.max(0, Math.ceil((cumulative - capacity) / factor - 1e-9));
    const urgentLimit = today ? addDays(today, 1) : null;
    let cumulative = 0;
    let urgentCumulative = 0;
    let urgentUntil = null;
    const monthEnds = [];
    for (const s of series) {
      cumulative += s.count;
      if (urgentLimit && deadlineOf(s.date) <= urgentLimit) { urgentCumulative = cumulative; urgentUntil = s.date; }
      const month = s.date.slice(0, 7);
      if (monthEnds.length && monthEnds[monthEnds.length - 1].month === month) monthEnds[monthEnds.length - 1].cumulative = cumulative;
      else monthEnds.push({ month, cumulative });
    }
    const urgentNeed = urgentUntil ? bottlesFor(urgentCumulative) : 0;
    const monthNeeds = [];
    let covered = urgentNeed;
    monthEnds.forEach(({ month, cumulative: total }) => {
      const bottles = bottlesFor(total) - covered;
      if (bottles <= 0) return;
      // この月の分が要りはじめる出荷日（それまでの発注分でまかなえなくなる最初の日）と、その発注期限
      let running = 0;
      const startsOn = series.find((s) => { running += s.count; return running > capacity + covered * factor + 1e-9; }).date;
      monthNeeds.push({ month, bottles, from: startsOn, fromWeekday: weekday(startsOn), orderBy: deadlineOf(startsOn), orderByWeekday: weekday(deadlineOf(startsOn)) });
      covered += bottles;
    });

    let level = 'ok';
    if (runsOutOn && today && orderBy <= addDays(today, 1)) level = 'urgent';
    else if (runsOutOn && today && orderBy <= addDays(today, 6)) level = 'soon';
    else if (shortage > 0) level = 'later';
    else if (wine.stock <= lowStock) level = 'low';

    const notes = [];
    if (runsOutOn && today && orderBy < today) notes.push('発注期限を過ぎています。今日発注しても、届く前に足りなくなる可能性があります');
    if (wine.stock < 0) notes.push('在庫がマイナスです。記録を確認してください');
    if (isForecast) notes.push(`${plan} は定期レポートにないため、月平均${forecasts[plan]}件を平日にならした見込みで計算しています`);
    if (plan === 'PRO') notes.push(`PRO は出荷日（27日）の${proArriveDaysBefore}日前までに届くよう、発注期限を早めています`);
    // 画面の1行目に出す短い注意（notes の説明は「くわしく」に入る）
    const warnings = [];
    if (runsOutOn && today && orderBy < today) warnings.push('発注期限切れ');
    if (wine.stock < 0) warnings.push('在庫マイナス');

    return {
      id: wine.id,
      name: wine.name,
      plan,
      stock: wine.stock,
      smallBottles,
      shipments,
      forecast: isForecast ? forecasts[plan] : null,
      need,
      shortage,
      // 至急で発注する最小限の本数と、それでまかなう最後の出荷日・配送予定日
      urgentNeed,
      urgentUntil: urgentNeed ? urgentUntil : null,
      urgentUntilWeekday: urgentNeed ? weekday(urgentUntil) : null,
      urgentDeliveryUntil: urgentNeed && plan !== 'PRO' ? lastDeliveryFor(urgentUntil) : null,
      // 月ごとに必要な本数（至急の分は入れない）
      monthNeeds,
      runsOutOn,
      runsOutWeekday: runsOutOn ? weekday(runsOutOn) : null,
      arriveBy,
      arriveByWeekday: arriveBy ? weekday(arriveBy) : null,
      orderBy,
      orderByWeekday: orderBy ? weekday(orderBy) : null,
      price: wine.price,
      level,
      notes,
      warnings,
    };
  });

  items.sort((a, b) => (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    || String(a.runsOutOn || '9999').localeCompare(String(b.runsOutOn || '9999'))
    || (a.stock - b.stock)
    || a.id.localeCompare(b.id, 'ja', { numeric: true }));

  const counts = { urgent: 0, soon: 0, later: 0, low: 0, ok: 0 };
  items.forEach((item) => { counts[item.level] += 1; });

  return { today, leadDays, lowStock, arriveDaysBefore, proArriveDaysBefore, factor, horizonEnd: lastDate, counts, items };
}

module.exports = { stockFromCsv, buildStockAlerts, planOfWine, toNumber, DEFAULT_LEAD_DAYS, DEFAULT_LOW_STOCK, DEFAULT_ARRIVE_DAYS_BEFORE, DEFAULT_PRO_ARRIVE_DAYS_BEFORE };
