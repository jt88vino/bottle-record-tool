const { loadConfig } = require('../lib/config-store');
const MAX_ITEMS = 2400;

function formatNumber(value) {
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value);
}

function badRequest(response, error) {
  return response.status(400).json({ error });
}

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'POSTで送信してください。' });
  }

  const { type = 'bottling', date, items, notes = '', supplier = '', recorderName = '' } = request.body || {};
  if (!['bottling', 'incoming'].includes(type)) return badRequest(response, '記録種別が正しくありません。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return badRequest(response, type === 'incoming' ? '記入日が正しくありません。' : '作業日が正しくありません。');
  if (typeof notes !== 'string' || notes.length > 1000) return badRequest(response, '備考は1,000文字以内で入力してください。');
  const notesOnly = type === 'bottling' && Array.isArray(items) && items.length === 0 && notes.trim().length > 0;
  if (!Array.isArray(items) || items.length > MAX_ITEMS || (items.length < 1 && !notesOnly)) return badRequest(response, type === 'bottling' ? '使用本数または備考を入力してください。' : 'ワインの入力内容が正しくありません。');
  if (typeof supplier !== 'string' || supplier.length > 180) return badRequest(response, '仕入先は180文字以内で入力してください。');
  if (typeof recorderName !== 'string' || !recorderName.trim() || recorderName.trim().length > 60) return badRequest(response, '記入者名を1〜60文字で入力してください。');

  const config = await loadConfig();
  const itemLabels = new Map(config.groups.flatMap((group) => group.rows.map((row) => [row.id, row])));
  const validItems = items.map((item) => {
    if (!itemLabels.has(item.id)) return null;
    if (!Number.isInteger(item.bottles) || item.bottles < 1 || item.bottles > 9999) return null;
    const itemNote = typeof item.itemNote === 'string' ? item.itemNote.trim() : '';
    if (itemNote.length > 1000) return null;
    const row = itemLabels.get(item.id);
    return { program: row.label, wineName: row.wineName || '（ワイン名未設定）', importerName: row.importerName || '', bottles: item.bottles, smallBottles: item.bottles * config.smallBottleFactor, itemNote };
  });
  if (validItems.some((item) => item === null)) return badRequest(response, '本数または銘柄別備考の入力内容が正しくありません。');

  const totalBottles = validItems.reduce((sum, item) => sum + item.bottles, 0);
  const itemLines = validItems
    .map((item) => type === 'incoming'
      ? `• ${item.program}｜${item.wineName}: ${formatNumber(item.bottles)}本${item.itemNote ? `\n  備考: ${item.itemNote}` : ''}`
      : `• ${item.program}｜${item.wineName}: ${formatNumber(item.bottles)}本 → 小瓶 ${formatNumber(item.smallBottles)}本`)
    .join('\n') || '• 本数入力なし（備考のみの記録）';
  const message = type === 'incoming'
    ? `*入荷記録*\n*記入日*: ${date}\n*記入者*: ${recorderName.trim()}\n\n*入荷ワイン*\n${itemLines}\n\n*合計*: ${formatNumber(totalBottles)}本${supplier.trim() ? `\n*仕入先*: ${supplier.trim()}` : ''}${notes.trim() ? `\n\n*備考*\n${notes.trim()}` : ''}`
    : `*${config.title}*\n*作業日*: ${date}\n*記入者*: ${recorderName.trim()}\n\n*使用ワイン*\n${itemLines}\n\n*合計*: 使用 ${formatNumber(totalBottles)}本 / 小瓶 ${formatNumber(totalBottles * config.smallBottleFactor)}本${notes.trim() ? `\n\n*備考*\n${notes.trim()}` : ''}`;

  const sheetsUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const sheetsSecret = process.env.GOOGLE_SHEETS_SYNC_SECRET;
  if (!sheetsUrl || !sheetsSecret) return response.status(503).json({ error: 'スプレッドシート連携の設定がまだ完了していません。管理者に連絡してください。' });
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const sheetItems = validItems.length ? validItems : [{ program: '', wineName: '', importerName: '', bottles: 0, smallBottles: 0, itemNote: '' }];

  try {
    const sheetResponse = await fetch(sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type, date, items: sheetItems, notes: notes.trim(), supplier: supplier.trim(), recorderName: recorderName.trim(), secret: sheetsSecret }),
    });
    const sheetResult = await sheetResponse.json().catch(() => ({}));
    if (!sheetResponse.ok || !sheetResult.ok) throw new Error(sheetResult.error || `Google Sheets returned ${sheetResponse.status}`);
  } catch (error) {
    console.error('Google Sheets delivery failed:', error.message);
    return response.status(502).json({ error: 'スプレッドシートへの記録に失敗しました。時間をおいてもう一度お試しください。' });
  }

  if (!webhookUrl) return response.status(207).json({ ok: false, sheetsSaved: true, error: 'スプレッドシートには記録しましたが、Slack通知の設定がまだ完了していません。' });

  try {
    const slackResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text: message }),
    });
    if (!slackResponse.ok) throw new Error(`Slack returned ${slackResponse.status}`);
    return response.status(200).json({ ok: true, sheetsSaved: true });
  } catch (error) {
    console.error('Slack delivery failed:', error.message);
    return response.status(207).json({ ok: false, sheetsSaved: true, error: 'スプレッドシートには記録しましたが、Slackへの送信に失敗しました。再送は行わないでください。' });
  }
};
