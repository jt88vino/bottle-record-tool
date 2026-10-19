const { buildSchedule, rowsFromCsv, rowsFromExtra, rowsFromAdditional, countsByDelivery, winesFromConfig, todayInJapan, reportFreshness, DEFAULT_FACTOR } = require('../lib/shipment-schedule');
const { buildStockAlerts } = require('../lib/stock-alerts');
const { recordShipments, fillEstimates, rowsFromLedger, consumedByPlan } = require('../lib/small-bottles');
const { applyStockCount } = require('../lib/stock-count');
const { arrivalsFromSource } = require('../lib/arrivals');
const { loadOverrides } = require('../lib/arrival-overrides');
const { loadLedger, saveLedger } = require('../lib/ledger-store');
// 瓶詰め済みの小瓶を数える起点（2026-09-29 の瓶詰めを始める前の「瓶詰め使用」の累計）
const SMALL_BOTTLE_BASELINE = require('../data/small-bottle-baseline.json');
// 定期レポートに載っていない配送予定日の件数（連絡をもらった分。Vol はそのままの数字）
const EXTRA_DELIVERIES = require('../data/extra-deliveries.json');
// ワインボトルの実数（商品マスタ・在庫 H列）。発注アラートはこの数から数える（lib/stock-count.js）
const STOCK_COUNT = require('../data/stock-count.json');
const { loadConfig } = require('../lib/config-store');

// ECforce の定期受注レポートを貼ったスプレッドシート（リンクを知っている全員が閲覧可）
// 新しいレポートは、このシートに上書きで貼り付ければそのまま反映される
const SHEET_ID = '1QPTuxunbv9jnG10Ya0t7XPbETR5XLr6lpIsOEdFVNR4';
const SHEET_GID = '1128007068';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

// ワインの現在庫と小瓶ロス：瓶詰め・入荷・在庫管理の「商品マスタ・在庫」「小瓶ロス」（lib/stock-source.js）
const { loadStockSource, stockItemsFromSource, STOCK_SHEET_URL } = require('../lib/stock-source');

const LEAD_DAYS = 2; // 発注してから届くまで
const LOW_STOCK = 6; // この本数以下なら知らせる
const ARRIVE_DAYS_BEFORE = 7; // 出荷日当日では瓶詰めが間に合わないので、Vol は出荷日の1週間前までに届いている必要がある
const PRO_ARRIVE_DAYS_BEFORE = 14; // PRO は出荷日（27日）の2週間前までに届いている必要がある
// 定期レポートに出てこないプランの、月あたりの出荷の見込み（Vol.1 は新規のお客様向けで月平均130件）
const { FORECASTS } = require('../lib/forecasts');

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
    const [scheduleCsv, stockResult, settings, ledger, overrides] = await Promise.all([
      fetchCsv(SHEET_URL),
      // 在庫と小瓶ロスは瓶詰め記録のスプレッドシートから直接読む（入荷を記録した直後でも最新）
      loadStockSource().then((data) => ({ data }), (error) => ({ error })),
      loadWineSettings(),
      loadLedger(),
      loadOverrides().catch(() => ({})),
    ]);
    // 「これからの1週間」の起点は日本時間の今日。確認用に ?today=YYYY-MM-DD で差し替えられる
    const requested = String((request.query && request.query.today) || '');
    const today = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayInJapan();
    const reportRows = rowsFromCsv(scheduleCsv);
    // 連絡をもらった数（Vol.1 は月の見込みで数えるので使わない）
    const extraRows = rowsFromExtra(EXTRA_DELIVERIES, reportRows, { skipPlans: Object.keys(FORECASTS) });
    const knownRows = reportRows.concat(extraRows);
    // 定期レポートとは別の出荷（定期外など）。レポート・連絡・台帳の数に足す（台帳には書かない）
    const additionalRows = rowsFromAdditional(EXTRA_DELIVERIES, { skipPlans: Object.keys(FORECASTS) });

    // 定期レポートは注文が出た分から消えていくので、見えている出荷件数を台帳に控え、レポートに載る前に消えた日は
    // 見積もりを控える。在庫のシートが読めなくても控える（台帳が読めなかった回は、空の台帳で上書きしないよう保存しない）
    const start = SMALL_BOTTLE_BASELINE.startDate;
    // 連絡をもらった数は確かな数なので、訂正があれば台帳もその数に置き換える
    const recorded = [
      recordShipments(ledger, countsByDelivery(reportRows), start),
      recordShipments(ledger, countsByDelivery(extraRows), start, { exact: true }),
    ].some(Boolean);
    const estimated = fillEstimates(ledger, countsByDelivery(reportRows), start);
    if ((recorded || estimated) && !ledger.loadFailed) {
      await saveLedger(ledger).catch((error) => console.error('Could not save shipments ledger:', error.message));
    }
    // 台帳にあってレポートから消えた分も、出荷するまでは今後の出荷に入れる
    const rows = knownRows.concat(ledger.loadFailed ? [] : rowsFromLedger(ledger, knownRows, today), additionalRows);
    const schedule = buildSchedule(rows, { ...settings, today, forecasts: FORECASTS });

    // 在庫が読めなくても、出荷予定だけは表示する
    let stock = null;
    let stockError = null;
    try {
      if (stockResult.error) throw stockResult.error;
      const stockItems = stockItemsFromSource(stockResult.data);

      // 在庫はボトルの実数（H列）から数える。瓶詰め済みの小瓶は見積もらない（実物より多くなりやすいため）。
      // 数えた日〜昨日の出荷を台帳から引くので、台帳が読めない回は実数を使わず「現在在庫」で出す
      const additionalCounts = countsByDelivery(additionalRows);
      const counted = ledger.loadFailed ? null : applyStockCount(stockItems, STOCK_COUNT, {
        today,
        factor: schedule.factor,
        shipped: consumedByPlan(ledger, STOCK_COUNT.date, today, FORECASTS, additionalCounts),
        arrivals: arrivalsFromSource(stockResult.data, overrides),
      });

      stock = buildStockAlerts(schedule.days, counted ? counted.items : stockItems, {
        today, factor: schedule.factor, leadDays: LEAD_DAYS, lowStock: LOW_STOCK,
        arriveDaysBefore: ARRIVE_DAYS_BEFORE, proArriveDaysBefore: PRO_ARRIVE_DAYS_BEFORE, forecasts: FORECASTS,
        smallBottles: counted ? counted.smallBottles : {},
        arrivals: counted ? counted.arrivals : {},
      });
      stock.countedOn = counted ? counted.countedOn : null;
      stock.smallBottlesUnavailable = Boolean(ledger.loadFailed);
      stock.source = STOCK_SHEET_URL;
    } catch (error) {
      console.error('Stock alerts failed:', error.message);
      stockError = '在庫のスプレッドシートを読み込めなかったため、発注アラートを出せませんでした。';
    }

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      ...schedule,
      // 定期レポートを貼り替えていないと、出荷件数が実際とずれる（画面に警告を出す）
      report: reportFreshness(reportRows, today),
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
