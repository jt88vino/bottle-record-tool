// 発注アラートの在庫：ワインボトルの実数（data/stock-count.json、「商品マスタ・在庫」H列）から数える（2026-10-19 牛嶋さん指定）。
//
// 瓶詰め済みの小瓶は見積もらない（記録漏れ・ロスで実物より多くなり、10/19 に Vol.7 が発送できなかった）。代わりに
//   今日の残り（小瓶換算）＝ 実数×換算 ＋ 数えた日〜昨日に届いた発注×換算 − 数えた日〜昨日の出荷件数 − 数えた日からの販売出荷×換算
// とし、今日以降に届く発注は、届く日からの出荷に回す（lib/stock-alerts.js の options.arrivals）。
// 数えた時点の小瓶は数えないので、その分は余裕になる（少なめに見積もる側）。
// 実数の無い銘柄（PRO）は、これまでどおり在庫シートの「現在在庫」を使う。

function planOfWine(id) {
  const text = String(id || '').trim();
  const vol = text.match(/^vol\.?\s*(\d+)\s*-\s*\d+$/i);
  if (vol) return `Vol.${Number(vol[1])}`;
  if (/^pro\.?\s*\d+$/i.test(text)) return 'PRO';
  return null;
}

// stockItems: stockItemsFromSource の結果（sold＝販売出荷の累計）
// count: data/stock-count.json
// shipped: 数えた日〜昨日に出荷した件数 { プラン: 件数 }（consumedByPlan）
// arrivals: arrivalsFromSource の結果（arrivesOn＝届く日）
// 返り値：items（stock をボトルの残りに置き換え、counted を付ける）、smallBottles（開けたボトルの端数）、arrivals（今日以降に届く分）
function applyStockCount(stockItems, count, { today, factor, shipped = {}, arrivals = [] }) {
  const counted = (count && count.stock) || {};
  const date = String((count && count.date) || '');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const smallBottles = {};
  const pending = {};
  const items = stockItems.map((item) => {
    if (!valid || !Number.isFinite(Number(counted[item.id]))) return { ...item, counted: false };
    const mine = arrivals.filter((a) => a.id === item.id && a.arrivesOn >= date);
    const arrived = mine.filter((a) => a.arrivesOn < today).reduce((sum, a) => sum + a.bottles, 0);
    mine.filter((a) => a.arrivesOn >= today).forEach((a) => (pending[item.id] = pending[item.id] || []).push({ date: a.arrivesOn, bottles: a.bottles }));
    const soldSince = Math.max(0, (Number(item.sold) || 0) - (Number((count.sold || {})[item.id]) || 0));
    const small = (Number(counted[item.id]) + arrived - soldSince) * factor - (shipped[planOfWine(item.id)] || 0);
    // ボトルの本数と、開けたボトルの端数（小瓶）に分ける。足りなければマイナスのボトル
    const bottles = Math.floor(small / factor + 1e-9);
    const rest = Math.floor(small - bottles * factor + 1e-9);
    if (bottles >= 0 && rest > 0) smallBottles[item.id] = rest;
    return { ...item, stock: bottles, counted: true };
  });
  return { items, smallBottles, arrivals: pending, countedOn: valid ? date : null };
}

module.exports = { applyStockCount };
