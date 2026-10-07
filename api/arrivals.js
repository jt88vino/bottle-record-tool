// 今日（と次の出勤日）に届くワイン。勤怠アプリ（hw-kintai-v2.vercel.app）から読む
const { loadStockSource } = require('../lib/stock-source');
const { arrivalsFromSource, arrivalsOn, nextWorkday, addDays } = require('../lib/arrivals');
const { todayInJapan } = require('../lib/shipment-schedule');

module.exports = async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  if (request.method === 'OPTIONS') return response.status(204).end();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(request.query?.today || '') ? request.query.today : todayInJapan();
  try {
    const arrivals = arrivalsFromSource(await loadStockSource());
    const next = nextWorkday(addDays(today, 1));
    return response.status(200).json({ today, items: arrivalsOn(arrivals, today), next, nextItems: arrivalsOn(arrivals, next), fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('arrivals failed:', error.message);
    return response.status(502).json({ error: '届くワインを読み込めませんでした。' });
  }
};
