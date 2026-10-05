// 出荷も発注もしない日：土日と、data/closed-days.json の日（祝日・会社の休み）。
// 出荷日や期限がこの日にあたれば、その前の出荷できる日へ前倒しする（2026-10-05 牛嶋さん指定：祝日は出荷しない）
const CLOSED = require('../data/closed-days.json').dates || {};

function isShippingDay(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day !== 0 && day !== 6 && !Object.prototype.hasOwnProperty.call(CLOSED, key);
}

module.exports = { isShippingDay };
