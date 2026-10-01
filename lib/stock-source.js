// ワインの在庫と小瓶ロスの読み込み先：瓶詰め・入荷・在庫管理（瓶詰め記録ツールが書き込むスプレッドシート）。
// 「商品マスタ・在庫」と「小瓶ロス」を、シートに付けた Apps Script「小瓶在庫（瓶詰め記録）」の読み取り専用の窓口から読む
// （シートはリンク共有していないので、CSV では読めない）
const STOCK_API_URL = 'https://script.google.com/macros/s/AKfycbyyAtH4OoxAjbDVKGAoHW7e1iXF8II9sPDZbzRdBnPLC68zjWXo7ftY6kUqlOqKsZwv9w/exec';
const STOCK_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1XoEHG6P7YQZH54IP-iNBtL4Vp5GMNFw5FjxMqBNx1gk/edit#gid=1514766277';

async function loadStockSource({ timeoutMs = 20000 } = {}) {
  const response = await fetch(STOCK_API_URL, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.ok || !Array.isArray(data.stock)) {
    throw new Error((data && data.error) || `stock source responded ${response.status}`);
  }
  return data;
}

// 発注アラート（lib/stock-alerts.js）が使う形にする
function stockItemsFromSource(data) {
  return data.stock
    .filter((row) => /^(vol|pro)/i.test(String(row.id || '').trim()))
    .map((row) => {
      const name = String(row.name || '').trim();
      return {
        id: String(row.id).trim(),
        name: /未設定/.test(name) ? '' : name,
        stock: Number(row.stock) || 0,
        price: null,
        // 瓶詰めに使った本数の累計（瓶詰め済みの小瓶を数えるのに使う）
        bottled: Number.isFinite(Number(row.bottled)) ? Number(row.bottled) : null,
      };
    });
}

// 起点の日〜今日のロスの本数を、プログラム（vol.8-4 など）ごとに合計する
function lossesFromSource(data, startDate, today) {
  const totals = {};
  (data.losses || []).forEach((row) => {
    const date = String(row.date || '');
    const id = String(row.id || '').trim();
    const count = Number(row.count);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !id || !(count > 0)) return;
    if (date < startDate || date > today) return;
    totals[id] = (totals[id] || 0) + count;
  });
  return totals;
}

module.exports = { loadStockSource, stockItemsFromSource, lossesFromSource, STOCK_API_URL, STOCK_SHEET_URL };
