// 届く日の見込み：入荷記録（発注した時点で記録）の記入日 ＋ 商品マスタ・在庫 I列の日数（1day＝翌日着、2day＝翌々日着）。
// 備考・銘柄別備考に「10/2着」のように日付があれば、そちらを使う。
// 届く日が土日・祝日なら、次の出勤日に受け取る前提でその日に入れる（勤怠アプリの「今日届くワイン」に使う）
const { isShippingDay } = require('./closed-days');

function addDays(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
function nextWorkday(key) { let day = key; while (!isShippingDay(day)) day = addDays(day, 1); return day; }

// 備考の「10/2着」「10/2」→ 日付（発注日より前の月なら翌年）
function noteDate(text, orderDate) {
  const match = String(text || '').match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!match) return null;
  const month = Number(match[1]); const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year = Number(orderDate.slice(0, 4));
  if (month < Number(orderDate.slice(5, 7))) year += 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function orderKey(order) { return `${order.date || order.orderedOn}|${String(order.id).trim()}|${Number(order.bottles)}`; }

// overrides: { キー: 'YYYY-MM-DD' }（手で直した届く日。そのまま使い、出勤日へのずらしもしない）
function arrivalsFromSource(data, overrides = {}) {
  const lead = new Map((data.stock || []).map((row) => [String(row.id).trim(), Number(row.leadDays) || null]));
  const names = new Map((data.stock || []).map((row) => [String(row.id).trim(), String(row.name || '').trim()]));
  return (data.orders || []).map((order) => {
    const id = String(order.id || '').trim();
    const date = String(order.date || '');
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(Number(order.bottles) > 0)) return null;
    const explicit = noteDate(order.itemNote, date) || noteDate(order.note, date);
    const days = lead.get(id);
    const key = orderKey({ date, id, bottles: order.bottles });
    const manual = /^\d{4}-\d{2}-\d{2}$/.test(overrides[key] || '') ? overrides[key] : null;
    const expected = manual || explicit || (days ? addDays(date, days) : null);
    if (!expected) return null;
    const name = names.get(id) || order.name || '';
    return { key, id, name: /未設定/.test(name) ? '' : name, bottles: Number(order.bottles), orderedOn: date, expected, arrivesOn: manual || nextWorkday(expected), fromNote: Boolean(explicit), manual: Boolean(manual) };
  }).filter(Boolean);
}

// その日に届く分（銘柄ごとにまとめる）
function arrivalsOn(arrivals, day) {
  const byId = new Map();
  arrivals.filter((a) => a.arrivesOn === day).forEach((a) => {
    const row = byId.get(a.id) || { id: a.id, name: a.name, bottles: 0, moved: false };
    row.bottles += a.bottles; row.moved = row.moved || a.expected !== a.arrivesOn;
    byId.set(a.id, row);
  });
  const order = (id) => { const m = id.match(/^(vol|pro)\.?(\d+)(?:-(\d+))?/i); return m ? (m[1].toLowerCase() === 'pro' ? 1000 : 0) + Number(m[2]) * 10 + Number(m[3] || 0) : 9999; };
  return [...byId.values()].sort((a, b) => order(a.id) - order(b.id));
}

// これから届く分（1件ずつ、届く日順）。手で直すときはこの key を使う
function upcoming(arrivals, from, days = 30) {
  const until = addDays(from, days);
  const order = (id) => { const m = id.match(/^(vol|pro)\.?(\d+)(?:-(\d+))?/i); return m ? (m[1].toLowerCase() === 'pro' ? 1000 : 0) + Number(m[2]) * 10 + Number(m[3] || 0) : 9999; };
  return arrivals.filter((a) => a.arrivesOn >= from && a.arrivesOn <= until).sort((a, b) => (a.arrivesOn < b.arrivesOn ? -1 : a.arrivesOn > b.arrivesOn ? 1 : order(a.id) - order(b.id)));
}

module.exports = { upcoming, orderKey, arrivalsFromSource, arrivalsOn, noteDate, nextWorkday, addDays };
