// 一時的：社内アプリ作り直しのため、出荷件数の台帳を1回だけ書き出す（読み取りのみ・移行後に消す）
const { loadLedger } = require('../lib/ledger-store');
module.exports = async (request, response) => {
  const ledger = await loadLedger();
  if (ledger.loadFailed) return response.status(503).json({ error: 'ledger unavailable' });
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json(ledger);
};
