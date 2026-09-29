const { buildSchedule, rowsFromCsv } = require('../lib/shipment-schedule');

// ECforce の定期受注レポートを貼ったスプレッドシート（リンクを知っている全員が閲覧可）
// 新しいレポートは、このシートに上書きで貼り付ければそのまま反映される
const SHEET_ID = '1QPTuxunbv9jnG10Ya0t7XPbETR5XLr6lpIsOEdFVNR4';
const SHEET_GID = '1128007068';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

module.exports = async (request, response) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'GETで取得してください。' });
  }
  try {
    const upstream = await fetch(SHEET_URL, { redirect: 'follow' });
    const text = await upstream.text();
    if (!upstream.ok || /^\s*</.test(text)) throw new Error(`sheet responded ${upstream.status}`);
    const schedule = buildSchedule(rowsFromCsv(text));
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      ...schedule,
      source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Shipment schedule failed:', error.message);
    return response.status(502).json({ error: error.message.includes('列が見つかりません') ? error.message : '出荷予定のスプレッドシートを読み込めませんでした。' });
  }
};
