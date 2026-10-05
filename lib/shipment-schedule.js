// 定期便の「次回配送予定日」と「定期回数」から、出荷スケジュールを組み立てる。
//
// ルール（2026-09-29 牛嶋さん指定）
// - 定期回数はひとつ先の数字にする（1 → 2、2 → 3）
// - 2〜12 は Vol.2〜Vol.12、13 以上は PRO
// - 次回配送予定日は「お客様に届く日」。Vol はその前日に出荷する。前日が土日なら直前の金曜日に前倒し
// - PRO は月末発送なので、配送予定日の月の 27 日に出荷。27 日が土日なら直前の金曜日
// - 祝日は出荷しない（2026-10-05 牛嶋さん指定）。出荷日が祝日なら、その前の出荷できる日に前倒し（lib/closed-days.js）
//
// 日付はすべて UTC の暦日として扱い、タイムゾーンのずれを避ける。

const { isShippingDay } = require('./closed-days');

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const PRO_SHIP_DAY = 27;
const LAST_VOL = 12;

function parseDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

// 土日・祝日（lib/closed-days.js）なら、その前の出荷できる日へ前倒しする
function toWeekday(date) {
  let shipDate = date;
  while (!isShippingDay(toKey(shipDate))) shipDate = addDays(shipDate, -1);
  return shipDate;
}

function planLabel(nextCount) {
  return nextCount > LAST_VOL ? 'PRO' : `Vol.${nextCount}`;
}

function shipDateFor(deliveryDate, label) {
  if (label === 'PRO') {
    const monthEnd = new Date(Date.UTC(deliveryDate.getUTCFullYear(), deliveryDate.getUTCMonth(), PRO_SHIP_DAY));
    return toWeekday(monthEnd);
  }
  // お客様に届く日の前日に出荷する
  return toWeekday(addDays(deliveryDate, -1));
}

function planOrder(label) {
  return label === 'PRO' ? 999 : Number(label.replace('Vol.', ''));
}

// ── ワインの必要本数 ─────────────────────────────
// 1本のワインから小瓶が factor 本（既定 7.5）とれる。定期便1件には、そのプランの
// 各銘柄が小瓶1本ずつ入るので、銘柄ごとに「件数 ÷ factor」を切り上げた本数が要る。
// プラン全体の本数は、それに銘柄数（通常4）を掛けたもの。
const DEFAULT_FACTOR = 7.5;
const DEFAULT_WINES_PER_PLAN = 4;

function validFactor(value) {
  const factor = Number(value);
  return Number.isFinite(factor) && factor > 0 ? factor : DEFAULT_FACTOR;
}

// 浮動小数の誤差で 15.000000001 が 16 にならないよう、わずかに差し引いてから切り上げる
function bottlesPerWine(count, factor) {
  if (!count) return 0;
  return Math.ceil(count / factor - 1e-9);
}

// plan → [{ id, name }] の対応から、そのプランの銘柄一覧を返す。設定がなければ4枠を仮置き
function winesFor(label, wines) {
  const list = wines[label];
  if (Array.isArray(list) && list.length) return list;
  return Array.from({ length: DEFAULT_WINES_PER_PLAN }, (_, i) => ({ id: `${label}-${i + 1}`, name: '' }));
}

function withBottles(counts, factor, wines) {
  return Object.keys(counts)
    .sort((a, b) => planOrder(a) - planOrder(b))
    .map((label) => {
      const count = counts[label];
      const perWine = bottlesPerWine(count, factor);
      const list = winesFor(label, wines);
      return {
        label,
        count,
        exact: Math.round((count / factor) * 100) / 100,
        perWine,
        wineCount: list.length,
        bottles: perWine * list.length,
        wines: list.map((wine) => ({ ...wine, bottles: perWine })),
      };
    });
}

// 日本時間の今日（YYYY-MM-DD）。勤怠アプリが表示している日付と同じ基準
function todayInJapan(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

function daysBetween(fromKey, toKey_) {
  return Math.round((parseDate(toKey_) - parseDate(fromKey)) / 86400000);
}

// 今日から7日ずつ区切った「これからの1週間」。毎日、今日を起点にずれていく
// 1つ目 = 今日〜6日後、2つ目 = 7日後〜13日後 …。今日より前の出荷日は past にまとめる
function rollingWeeks(days, today, factor, wines) {
  const upcoming = days.filter((day) => day.date >= today);
  const pastDays = days.filter((day) => day.date < today);
  const lastIndex = upcoming.length ? Math.floor(daysBetween(today, upcoming[upcoming.length - 1].date) / 7) : -1;
  const grouped = aggregatePeriods(upcoming, (day) => String(Math.floor(daysBetween(today, day.date) / 7)).padStart(4, '0'), factor, wines);
  const byIndex = new Map(grouped.map((g) => [Number(g.key), g]));
  const weeks = [];
  for (let index = 0; index <= lastIndex; index += 1) {
    const start = toKey(addDays(parseDate(today), index * 7));
    const end = toKey(addDays(parseDate(today), index * 7 + 6));
    const found = byIndex.get(index);
    weeks.push({
      index,
      start,
      end,
      startWeekday: WEEKDAYS[parseDate(start).getUTCDay()],
      endWeekday: WEEKDAYS[parseDate(end).getUTCDay()],
      total: found ? found.total : 0,
      bottles: found ? found.bottles : 0,
      days: found ? found.days : [],
      plans: found ? found.plans : [],
    });
  }
  const past = pastDays.length ? aggregatePeriods(pastDays, () => 'past', factor, wines)[0] : null;
  return { weeks, past };
}

// days を keyOf でまとめ、件数と必要本数を出す
function aggregatePeriods(days, keyOf, factor, wines) {
  const map = new Map();
  days.forEach((day) => {
    const key = keyOf(day);
    if (!map.has(key)) map.set(key, { key, total: 0, counts: {}, days: [] });
    const entry = map.get(key);
    entry.total += day.total;
    entry.days.push({ date: day.date, weekday: day.weekday, total: day.total });
    day.plans.forEach((plan) => { entry.counts[plan.label] = (entry.counts[plan.label] || 0) + plan.count; });
  });
  return [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => {
      const plans = withBottles(entry.counts, factor, wines);
      return {
        key: entry.key,
        total: entry.total,
        bottles: plans.reduce((sum, plan) => sum + plan.bottles, 0),
        from: entry.days[0].date,
        to: entry.days[entry.days.length - 1].date,
        days: entry.days,
        plans,
      };
    });
}

// 瓶詰め記録の設定（groups）から、プラン名 → 銘柄一覧 の対応を作る
// 'vol.12' → 'Vol.12'、'Pro' → 'PRO'
function winesFromConfig(config) {
  const result = {};
  (config && Array.isArray(config.groups) ? config.groups : []).forEach((group) => {
    const raw = String(group.label || '').trim();
    const vol = raw.match(/^vol\.?\s*(\d+)$/i);
    const label = vol ? `Vol.${Number(vol[1])}` : (/^pro$/i.test(raw) ? 'PRO' : null);
    if (!label) return;
    result[label] = (group.rows || []).map((row) => ({ id: row.label || row.id, name: row.wineName || '' }));
  });
  return result;
}

function weekdaysBetween(fromKey, toKey_) {
  let count = 0;
  for (let date = parseDate(fromKey); toKey(date) <= toKey_; date = addDays(date, 1)) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

// 月（YYYY-MM）の見込みの件数。月あたりの件数 × 今日から月末までの平日 ÷ その月の平日（切り上げ）
function monthForecasts(monthKey, today, forecasts, factor, wines) {
  const [year, month] = monthKey.split('-').map(Number);
  const first = toKey(new Date(Date.UTC(year, month - 1, 1)));
  const last = toKey(new Date(Date.UTC(year, month, 0)));
  const from = today > first ? today : first;
  const all = weekdaysBetween(first, last);
  const left = from <= last ? weekdaysBetween(from, last) : 0;
  const counts = {};
  Object.entries(forecasts).forEach(([label, monthly]) => {
    const count = all ? Math.ceil((monthly * left) / all - 1e-9) : 0;
    if (count > 0) counts[label] = count;
  });
  return withBottles(counts, factor, wines).map((plan) => ({ ...plan, forecast: true }));
}

// rows: [{ deliveryDate: '2026/10/31 0:00', count: '1' }, ...]
// options: { factor: 7.5, wines: { 'Vol.2': [{ id, name }], ... } }
function buildSchedule(rows, options = {}) {
  const skipped = [];
  const byDate = new Map();
  const planTotals = {};

  rows.forEach((row, index) => {
    const deliveryDate = parseDate(row.deliveryDate);
    const countText = String(row.count || '').trim();
    const count = /^\d+$/.test(countText) ? Number(countText) : NaN;
    if (!deliveryDate || !Number.isInteger(count)) {
      skipped.push({ line: index + 2, deliveryDate: row.deliveryDate, count: row.count });
      return;
    }
    const label = planLabel(count + 1);
    const shipDate = shipDateFor(deliveryDate, label);
    const key = toKey(shipDate);
    if (!byDate.has(key)) {
      byDate.set(key, { date: key, weekday: WEEKDAYS[shipDate.getUTCDay()], total: 0, plans: {}, deliveryDates: {}, shifted: {}, pro: null, sources: {} });
    }
    const entry = byDate.get(key);
    entry.total += 1;
    entry.plans[label] = (entry.plans[label] || 0) + 1;
    const deliveryKey = toKey(deliveryDate);
    entry.deliveryDates[deliveryKey] = (entry.deliveryDates[deliveryKey] || 0) + 1;
    if (row.source) {
      const bySource = entry.sources[row.source] = entry.sources[row.source] || {};
      bySource[deliveryKey] = (bySource[deliveryKey] || 0) + 1;
    }
    if (label === 'PRO') {
      entry.pro = entry.pro || { count: 0, from: deliveryKey, to: deliveryKey };
      entry.pro.count += 1;
      if (deliveryKey < entry.pro.from) entry.pro.from = deliveryKey;
      if (deliveryKey > entry.pro.to) entry.pro.to = deliveryKey;
    } else if (deliveryKey !== key) {
      entry.shifted[deliveryKey] = (entry.shifted[deliveryKey] || 0) + 1;
    }
    planTotals[label] = (planTotals[label] || 0) + 1;
  });

  const bySourceList = (counts = {}) => Object.keys(counts)
    .sort()
    .map((date) => ({ date, weekday: WEEKDAYS[parseDate(date).getUTCDay()], count: counts[date] }));

  const days = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      date: entry.date,
      weekday: entry.weekday,
      total: entry.total,
      plans: Object.keys(entry.plans)
        .sort((a, b) => planOrder(a) - planOrder(b))
        .map((label) => ({ label, count: entry.plans[label] })),
      // 出荷日と違う日の配送分（土日の前倒し・PROの月末まとめ）を明示する
      deliveryDates: Object.keys(entry.deliveryDates)
        .sort()
        .map((date) => ({ date, weekday: WEEKDAYS[parseDate(date).getUTCDay()], count: entry.deliveryDates[date] })),
      // Vol の、お客様に届く日（配送予定日）ごとの件数
      shifted: Object.keys(entry.shifted)
        .sort()
        .map((date) => ({ date, weekday: WEEKDAYS[parseDate(date).getUTCDay()], count: entry.shifted[date] })),
      // 月末にまとめて出す PRO の件数と、元の配送予定日の範囲
      pro: entry.pro,
      // 定期レポートに無い分の、配送予定日ごとの件数。extra = 連絡をもらった数、fromLedger = 前に見えていて
      // レポートから消えた分（台帳の記録）、estimated = どこにも無く見積もった分、additional = 定期外などで足した分
      extra: bySourceList(entry.sources.extra),
      additional: bySourceList(entry.sources.additional),
      fromLedger: bySourceList(entry.sources.ledger),
      estimated: bySourceList(entry.sources.estimate),
    }));

  const factor = validFactor(options.factor);
  const wines = options.wines || {};
  const plans = withBottles(planTotals, factor, wines);
  // 起点の「今日」。指定がなければ最初の出荷日（テストで結果を固定するため）
  const today = /^\d{4}-\d{2}-\d{2}$/.test(options.today || '') ? options.today : (days[0] ? days[0].date : todayInJapan());
  const { weeks, past } = rollingWeeks(days, today, factor, wines);

  return {
    today,
    total: days.reduce((sum, day) => sum + day.total, 0),
    factor,
    bottles: plans.reduce((sum, plan) => sum + plan.bottles, 0),
    plans,
    days,
    weeks,
    past,
    // 月は出荷日の月で集計する。見込みのプラン（Vol.1）は、その月の今日から月末までの平日の分だけ入れる
    // 出荷日がすべて過ぎた月は出さない
    months: aggregatePeriods(days, (day) => day.date.slice(0, 7), factor, wines)
      .filter((month) => month.to >= today)
      .map((month) => ({ ...month, forecasts: monthForecasts(month.key, today, options.forecasts || {}, factor, wines) })),
    // 定期レポートに出てこないプランの月あたりの見込み（Vol.1 は月平均130件）
    forecasts: withBottles(options.forecasts || {}, factor, wines).map((plan) => ({ ...plan, forecast: true })),
    skipped,
  };
}

// シンプルな CSV パーサー（ダブルクォート・カンマ・改行を含むセルに対応）
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ヘッダー名から列を探す。列の順番が変わっても読めるようにする
function rowsFromCsv(text) {
  const [header = [], ...body] = parseCsv(text);
  const dateIndex = header.findIndex((name) => name.trim() === '次回配送予定日');
  const countIndex = header.findIndex((name) => name.trim() === '定期回数');
  if (dateIndex < 0 || countIndex < 0) {
    throw new Error('「次回配送予定日」と「定期回数」の列が見つかりません。');
  }
  return body.map((cells) => ({ deliveryDate: cells[dateIndex], count: cells[countIndex] }));
}

// { 配送予定日: { プラン: 件数 } } を、定期レポートと同じ形の行（1件1行）にする。
// プランはそのままの数字（Vol.8 → 定期回数7）。見積もりの小数は切り上げる。
// skipDates の配送予定日と、skipPlans のプラン（見込みで数える Vol.1 など）は足さない
function rowsFromCounts(deliveries, { source, skipDates = new Set(), skipPlans = [], keep = () => true } = {}) {
  const rows = [];
  Object.entries(deliveries || {}).forEach(([date, plans]) => {
    const deliveryDate = parseDate(date);
    if (!deliveryDate || skipDates.has(toKey(deliveryDate))) return;
    Object.entries(plans || {}).forEach(([label, count]) => {
      const vol = String(label).match(/^vol\.?\s*(\d+)$/i);
      const plan = vol ? Number(vol[1]) : (/^pro$/i.test(String(label)) ? LAST_VOL + 1 : 0);
      const n = Math.ceil(Number(count) - 1e-9);
      if (!plan || !Number.isFinite(n) || n <= 0) return;
      const name = planLabel(plan);
      if (skipPlans.includes(name) || !keep(toKey(deliveryDate), name)) return;
      for (let i = 0; i < n; i += 1) rows.push({ deliveryDate: toKey(deliveryDate), count: String(plan - 1), source });
    });
  });
  return rows;
}

// 定期レポートに載らない配送予定日の件数（連絡をもらった分、data/extra-deliveries.json）。
// 連絡の数字はそのままの Vol（ひとつ先に進めない）。レポートに同じ配送予定日があれば、二重に数えないよう足さない。
// Vol.1 は月の見込みで数えるので、連絡の数は使わない（options.skipPlans）
function rowsFromExtra(extra, reportRows = [], options = {}) {
  const reported = new Set(reportRows.map((row) => parseDate(row.deliveryDate)).filter(Boolean).map(toKey));
  return rowsFromCounts((extra && extra.deliveries) || {}, { source: 'extra', skipDates: reported, skipPlans: options.skipPlans || [] });
}

// 定期レポートとは別に出荷する分（定期外の注文など、data/extra-deliveries.json の additional）。
// レポートや連絡の数とは別の出荷なので、同じ配送予定日があっても足す
function rowsFromAdditional(extra, options = {}) {
  return rowsFromCounts((extra && extra.additional) || {}, { source: 'additional', skipPlans: options.skipPlans || [] });
}

// 配送予定日（お客様に届く日）ごと・プランごとの件数 { '2026-10-04': { 'Vol.8': 3, PRO: 5 }, ... }
function countsByDelivery(rows) {
  const result = {};
  rows.forEach((row) => {
    const deliveryDate = parseDate(row.deliveryDate);
    const countText = String(row.count || '').trim();
    if (!deliveryDate || !/^\d+$/.test(countText)) return;
    const key = toKey(deliveryDate);
    const label = planLabel(Number(countText) + 1);
    result[key] = result[key] || {};
    result[key][label] = (result[key][label] || 0) + 1;
  });
  return result;
}

module.exports = {
  buildSchedule, rowsFromCsv, rowsFromExtra, rowsFromAdditional, rowsFromCounts, countsByDelivery, parseCsv, shipDateFor, planLabel, parseDate, toKey,
  bottlesPerWine, winesFromConfig, todayInJapan, DEFAULT_FACTOR,
};
