// 今日（と次の出勤日）に届くワイン。勤怠アプリ（hw-kintai-v2.vercel.app）から読む。
// POST（編集用パスワード）で到着日を手で直せる：{ keys: [...], date: 'YYYY-MM-DD' }（date を空にすると自動に戻す）
const { loadStockSource } = require('../lib/stock-source');
const { arrivalsFromSource, arrivalsOn, upcoming, nextWorkday, addDays } = require('../lib/arrivals');
const { loadOverrides, saveOverrides } = require('../lib/arrival-overrides');
const { todayInJapan } = require('../lib/shipment-schedule');

module.exports = async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method === 'POST') {
    if (!process.env.ADMIN_SECRET || request.headers['x-admin-key'] !== process.env.ADMIN_SECRET) return response.status(401).json({ error: '編集用パスワードが正しくありません。' });
    const { keys, date } = request.body || {};
    if (!Array.isArray(keys) || !keys.length || keys.length > 50 || keys.some((k) => typeof k !== 'string' || k.length > 80)) return response.status(400).json({ error: '直す発注が正しくありません。' });
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return response.status(400).json({ error: '日付が正しくありません。' });
    try {
      const overrides = await loadOverrides();
      keys.forEach((k) => { if (date) overrides[k] = date; else delete overrides[k]; });
      await saveOverrides(overrides);
      return response.status(200).json({ ok: true });
    } catch (error) {
      console.error('arrival override failed:', error.message);
      return response.status(502).json({ error: '保存できませんでした。もう一度お試しください。' });
    }
  }
  response.setHeader('Cache-Control', 'no-store');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(request.query?.today || '') ? request.query.today : todayInJapan();
  try {
    const [source, overrides] = await Promise.all([loadStockSource(), loadOverrides().catch(() => ({}))]);
    const arrivals = arrivalsFromSource(source, overrides);
    const next = nextWorkday(addDays(today, 1));
    return response.status(200).json({ today, items: arrivalsOn(arrivals, today), next, nextItems: arrivalsOn(arrivals, next), upcoming: upcoming(arrivals, today), fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('arrivals failed:', error.message);
    return response.status(502).json({ error: '届くワインを読み込めませんでした。' });
  }
};
