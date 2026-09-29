// 過ぎた日の出荷件数（プランごと）の記録。定期レポートを新しいものに貼り替えると、
// 過ぎた日の出荷が消えてしまうので、見えているうちに日ごとに書き留めておく。
// 保存先は設定と同じ Vercel Blob。トークンが無いとき（手元での確認）はメモリだけで持つ。
const { get, put } = require('@vercel/blob');

const LEDGER_PATHNAME = 'bottling-record/shipments-ledger.json';
let memoryLedger = null;

function emptyLedger() {
  return { days: {} };
}

async function loadLedger() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return memoryLedger ? JSON.parse(JSON.stringify(memoryLedger)) : emptyLedger();
  try {
    const result = await get(LEDGER_PATHNAME, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return emptyLedger();
    const ledger = JSON.parse(await new Response(result.stream).text());
    return ledger && typeof ledger.days === 'object' ? ledger : emptyLedger();
  } catch (error) {
    console.error('Could not load shipments ledger:', error.message);
    return emptyLedger();
  }
}

async function saveLedger(ledger) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) { memoryLedger = JSON.parse(JSON.stringify(ledger)); return; }
  await put(LEDGER_PATHNAME, JSON.stringify(ledger), {
    access: 'private',
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: 'application/json',
  });
}

module.exports = { loadLedger, saveLedger, emptyLedger, LEDGER_PATHNAME };
