const { buildSchedule, rowsFromCsv, winesFromConfig, todayInJapan, DEFAULT_FACTOR } = require('../lib/shipment-schedule');
const { loadConfig } = require('../lib/config-store');

// ECforce の定期受注レポートを貼ったスプレッドシート（リンクを知っている全員が閲覧可）
// 新しいレポートは、このシートに上書きで貼り付ければそのまま反映される
const SHEET_ID = '1QPTuxunbv9jnG10Ya0t7XPbETR5XLr6lpIsOEdFVNR4';
const SHEET_GID = '1128007068';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

// 小瓶換算（1本 = 小瓶7.5本）と各Volの銘柄は、瓶詰め記録の編集者設定から読む
async function loadWineSettings() {
  try {
    const config = await loadConfig();
    return { factor: Number(config.smallBottleFactor) || DEFAULT_FACTOR, wines: winesFromConfig(config) };
  } catch (error) {
    console.error('Config unavailable for shipments:', error.message);
    return { factor: DEFAULT_FACTOR, wines: {} };
  }
}

module.exports = async (request, response) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'GETで取得してください。' });
  }
  try {
    const [upstream, settings] = await Promise.all([fetch(SHEET_URL, { redirect: 'follow' }), loadWineSettings()]);
    const text = await upstream.text();
    if (!upstream.ok || /^\s*</.test(text)) throw new Error(`sheet responded ${upstream.status}`);
    // 「これからの1週間」の起点は日本時間の今日。確認用に ?today=YYYY-MM-DD で差し替えられる
    const requested = String((request.query && request.query.today) || '');
    const today = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayInJapan();
    const schedule = buildSchedule(rowsFromCsv(text), { ...settings, today });
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
