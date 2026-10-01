// 出荷日が過ぎた出荷を「小瓶を使った」記録として返す。在庫管理シートの Apps Script が毎朝読み、
// 「小瓶出荷記録」タブに書き写す（台帳は Vercel Blob。消えてもシートの記録は残る）
const { loadLedger } = require('../lib/ledger-store');
const { usageRows } = require('../lib/small-bottles');
const { todayInJapan } = require('../lib/shipment-schedule');
const SMALL_BOTTLE_BASELINE = require('../data/small-bottle-baseline.json');
const EXTRA_DELIVERIES = require('../data/extra-deliveries.json');
const { FORECASTS } = require('../lib/forecasts');

module.exports = async (request, response) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'GETで取得してください。' });
  }
  const ledger = await loadLedger();
  if (ledger.loadFailed) return response.status(503).json({ error: '出荷の記録を読み込めませんでした。' });
  const requested = String((request.query && request.query.today) || '');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayInJapan();
  const startDate = SMALL_BOTTLE_BASELINE.startDate;
  const rows = usageRows(ledger, startDate, today, { extraDates: Object.keys(EXTRA_DELIVERIES.deliveries || {}), forecasts: FORECASTS });
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({
    startDate,
    today,
    // この日付の行はこの一覧に置き換える（一覧に無い日付のシートの行はそのまま残す）
    dates: [...new Set(rows.map((row) => row.shipDate))],
    rows,
  });
};
