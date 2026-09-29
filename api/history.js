module.exports = async (request, response) => {
  if (!['GET', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, DELETE');
    return response.status(405).json({ error: 'GETまたはDELETEで送信してください。' });
  }
  const kind = request.query.type;
  if (!['bottling', 'incoming', 'shipping'].includes(kind)) return response.status(400).json({ error: '記録種別が正しくありません。' });
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SHEETS_SYNC_SECRET;
  if (!url || !secret) return response.status(503).json({ error: 'スプレッドシート連携の設定がまだ完了していません。' });
  try {
    const rowNumber = Number(request.body?.rowNumber);
    if (request.method === 'DELETE' && (!Number.isInteger(rowNumber) || rowNumber < 4)) return response.status(400).json({ error: '削除対象が正しくありません。' });
    // Apps Script が混んでいると数十秒待たされることがあるので、読み取りは25秒で打ち切る（画面側が1回やり直す）。
    // 削除は途中で打ち切ると結果が分からなくなるため、時間を区切らない。
    const signal = request.method === 'GET' ? AbortSignal.timeout(25000) : undefined;
    const upstream = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(request.method === 'DELETE' ? { type: 'deleteHistory', kind, rowNumber, secret } : { type: 'history', kind, secret }), signal });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !result.ok) throw new Error(result.error || 'history unavailable');
    // 中身のない応答を「記録なし」と取り違えないよう、一覧が無ければ失敗として扱う
    if (request.method === 'GET' && !Array.isArray(result.items)) throw new Error('history returned no list');
    return response.status(200).json(request.method === 'DELETE' ? { ok: true } : { items: result.items });
  } catch (error) {
    console.error('History request failed:', error.message);
    if (error.name === 'TimeoutError') return response.status(504).json({ error: '履歴の読み込みに時間がかかっています。' });
    return response.status(502).json({ error: request.method === 'DELETE' ? '履歴を削除できませんでした。' : '履歴を読み込めませんでした。' });
  }
};
