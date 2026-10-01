// シート「小瓶ロス」（在庫管理シートのタブ。日付・プログラム・本数・理由…）を読み、
// 起点の日〜今日のロスの本数をプログラム（vol.8-4 など）ごとに合計する
const { parseCsv } = require('./shipment-schedule');

function toKey(text) {
  const match = String(text || '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function lossesFromCsv(text, startDate, today) {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row.some((c) => c.trim() === '日付') && row.some((c) => c.trim() === 'プログラム') && row.some((c) => c.trim().startsWith('本数')));
  if (headerIndex < 0) throw new Error('小瓶ロスのタブに「日付」「プログラム」「本数」の見出しが見つかりません。');
  const header = rows[headerIndex].map((c) => c.trim());
  const col = { date: header.indexOf('日付'), id: header.indexOf('プログラム'), count: header.findIndex((c) => c.startsWith('本数')) };
  const totals = {};
  rows.slice(headerIndex + 1).forEach((cells) => {
    const date = toKey(cells[col.date]);
    const id = String(cells[col.id] || '').trim();
    const count = Number(String(cells[col.count] || '').replace(/[,，\s本]/g, ''));
    if (!date || !id || !Number.isFinite(count) || count <= 0) return;
    if (date < startDate || date > today) return;
    totals[id] = (totals[id] || 0) + count;
  });
  return totals;
}

module.exports = { lossesFromCsv };
