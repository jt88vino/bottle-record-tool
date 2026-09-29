// 定期便の「次回配送予定日」と「定期回数」から、出荷スケジュールを組み立てる。
//
// ルール（2026-09-29 牛嶋さん指定）
// - 定期回数はひとつ先の数字にする（1 → 2、2 → 3）
// - 2〜12 は Vol.2〜Vol.12、13 以上は PRO
// - Vol は配送予定日に出荷。土日なら直前の金曜日に前倒し
// - PRO は月末発送なので、配送予定日の月の 27 日に出荷。27 日が土日なら直前の金曜日
//
// 日付はすべて UTC の暦日として扱い、タイムゾーンのずれを避ける。

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

// 土日なら直前の金曜日へ前倒しする
function toWeekday(date) {
  const day = date.getUTCDay();
  if (day === 6) return addDays(date, -1);
  if (day === 0) return addDays(date, -2);
  return date;
}

function planLabel(nextCount) {
  return nextCount > LAST_VOL ? 'PRO' : `Vol.${nextCount}`;
}

function shipDateFor(deliveryDate, label) {
  if (label === 'PRO') {
    const monthEnd = new Date(Date.UTC(deliveryDate.getUTCFullYear(), deliveryDate.getUTCMonth(), PRO_SHIP_DAY));
    return toWeekday(monthEnd);
  }
  return toWeekday(deliveryDate);
}

function planOrder(label) {
  return label === 'PRO' ? 999 : Number(label.replace('Vol.', ''));
}

// rows: [{ deliveryDate: '2026/10/31 0:00', count: '1' }, ...]
function buildSchedule(rows) {
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
      byDate.set(key, { date: key, weekday: WEEKDAYS[shipDate.getUTCDay()], total: 0, plans: {}, deliveryDates: {}, shifted: {}, pro: null });
    }
    const entry = byDate.get(key);
    entry.total += 1;
    entry.plans[label] = (entry.plans[label] || 0) + 1;
    const deliveryKey = toKey(deliveryDate);
    entry.deliveryDates[deliveryKey] = (entry.deliveryDates[deliveryKey] || 0) + 1;
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
      // 土日から前倒しした Vol の配送分
      shifted: Object.keys(entry.shifted)
        .sort()
        .map((date) => ({ date, weekday: WEEKDAYS[parseDate(date).getUTCDay()], count: entry.shifted[date] })),
      // 月末にまとめて出す PRO の件数と、元の配送予定日の範囲
      pro: entry.pro,
    }));

  const plans = Object.keys(planTotals)
    .sort((a, b) => planOrder(a) - planOrder(b))
    .map((label) => ({ label, count: planTotals[label] }));

  return {
    total: days.reduce((sum, day) => sum + day.total, 0),
    plans,
    days,
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

module.exports = { buildSchedule, rowsFromCsv, parseCsv, shipDateFor, planLabel, parseDate, toKey };
