// 瓶詰め・発注の過去の記録（1日分ずつ）。直近2日より前も見られるよう、在庫シートの読み取り窓口から読む（削除はできない）
const { STOCK_API_URL } = require('../lib/stock-source');

module.exports = async (request, response) => {
  const kind = request.query.type;
  const date = request.query.date || '';
  if (!['bottling', 'incoming'].includes(kind)) return response.status(400).json({ error: '記録種別が正しくありません。' });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return response.status(400).json({ error: '日付が正しくありません。' });
  try {
    const upstream = await fetch(`${STOCK_API_URL}?records=${kind}${date ? `&date=${date}` : ''}`, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const result = await upstream.json().catch(() => null);
    if (!upstream.ok || !result || !result.ok || !Array.isArray(result.items)) throw new Error((result && result.error) || `records ${upstream.status}`);
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({ days: result.days, date: result.date, items: result.items });
  } catch (error) {
    console.error('records failed:', error.message);
    return response.status(502).json({ error: '過去の記録を読み込めませんでした。' });
  }
};
