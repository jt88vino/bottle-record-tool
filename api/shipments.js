const { buildSchedule, rowsFromCsv, winesFromConfig, todayInJapan, DEFAULT_FACTOR } = require('../lib/shipment-schedule');
const { stockFromCsv, buildStockAlerts } = require('../lib/stock-alerts');
const { loadConfig } = require('../lib/config-store');

// ECforce の定期受注レポートを貼ったスプレッドシート（リンクを知っている全員が閲覧可）
// 新しいレポートは、このシートに上書きで貼り付ければそのまま反映される
const SHEET_ID = '1QPTuxunbv9jnG10Ya0t7XPbETR5XLr6lpIsOEdFVNR4';
const SHEET_GID = '1128007068';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

// ワインの現在庫：「WTワイン_在庫管理_新デザイン案」の「プログラム在庫」タブ。
// 瓶詰め記録シートの「商品マスタ・在庫」を IMPORTRANGE で自動反映している
const STOCK_ID = '1oMgDnV4b0h_GXL_XlkWDotrtwcCZx0DM1rFWVVJtYYM';
const STOCK_GID = '388047452';
const STOCK_URL = `https://docs.google.com/spreadsheets/d/${STOCK_ID}/export?format=csv&gid=${STOCK_GID}`;

const LEAD_DAYS = 2; // 発注してから届くまで
const LOW_STOCK = 6; // この本数以下なら知らせる

async function fetchCsv(url) {
  const response = await fetch(url, { redirect: 'follow' });
  const text = await response.text();
  if (!response.ok || /^\s*</.test(text)) throw new Error(`sheet responded ${response.status}`);
  return text;
}

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
    const [scheduleCsv, stockResult, settings] = await Promise.all([
      fetchCsv(SHEET_URL),
      fetchCsv(STOCK_URL).then((text) => ({ text }), (error) => ({ error })),
      loadWineSettings(),
    ]);
    // 「これからの1週間」の起点は日本時間の今日。確認用に ?today=YYYY-MM-DD で差し替えられる
    const requested = String((request.query && request.query.today) || '');
    const today = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayInJapan();
    const schedule = buildSchedule(rowsFromCsv(scheduleCsv), { ...settings, today });

    // 在庫が読めなくても、出荷予定だけは表示する
    let stock = null;
    let stockError = null;
    try {
      if (stockResult.error) throw stockResult.error;
      stock = buildStockAlerts(schedule.days, stockFromCsv(stockResult.text), {
        today, factor: schedule.factor, leadDays: LEAD_DAYS, lowStock: LOW_STOCK,
      });
      stock.source = `https://docs.google.com/spreadsheets/d/${STOCK_ID}/edit#gid=${STOCK_GID}`;
    } catch (error) {
      console.error('Stock alerts failed:', error.message);
      stockError = '在庫のスプレッドシートを読み込めなかったため、発注アラートを出せませんでした。';
    }

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      ...schedule,
      stock,
      stockError,
      source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Shipment schedule failed:', error.message);
    return response.status(502).json({ error: error.message.includes('列が見つかりません') ? error.message : '出荷予定のスプレッドシートを読み込めませんでした。' });
  }
};
