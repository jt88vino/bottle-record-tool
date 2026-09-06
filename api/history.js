module.exports = async (request, response) => {
  if (!['GET', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, DELETE');
    return response.status(405).json({ error: 'GETまたはDELETEで送信してください。' });
  }
  const kind = request.query.type;
  if (!['bottling', 'incoming'].includes(kind)) return response.status(400).json({ error: '記録種別が正しくありません。' });
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SHEETS_SYNC_SECRET;
  if (!url || !secret) return response.status(503).json({ error: 'スプレッドシート連携の設定がまだ完了していません。' });
  try {
    const rowNumber = Number(request.body?.rowNumber);
    if (request.method === 'DELETE' && (!Number.isInteger(rowNumber) || rowNumber < 4)) return response.status(400).json({ error: '削除対象が正しくありません。' });
    const upstream = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(request.method === 'DELETE' ? { type: 'deleteHistory', kind, rowNumber, secret } : { type: 'history', kind, secret }) });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !result.ok) throw new Error(result.error || 'history unavailable');
    return response.status(200).json(request.method === 'DELETE' ? { ok: true } : { items: Array.isArray(result.items) ? result.items : [] });
  } catch (error) {
    console.error('History request failed:', error.message);
    return response.status(502).json({ error: request.method === 'DELETE' ? '履歴を削除できませんでした。' : '履歴を読み込めませんでした。' });
  }
};
