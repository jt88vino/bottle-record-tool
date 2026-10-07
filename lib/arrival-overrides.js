// 到着日を手で直した分（牛嶋さんが勤怠アプリの「今日届くワイン」から直す）。キー＝発注の記入日|銘柄|本数 → 届く日
const { get, put } = require('@vercel/blob');

const PATHNAME = 'bottling-record/arrival-overrides.json';
let memory = {};

async function loadOverrides() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { ...memory };
  const result = await get(PATHNAME, { access: 'private', useCache: false });
  if (!result) return {};
  if (result.statusCode !== 200 || !result.stream) throw new Error(`overrides responded ${result.statusCode}`);
  const data = JSON.parse(await new Response(result.stream).text());
  return data && typeof data.overrides === 'object' && data.overrides ? data.overrides : {};
}

async function saveOverrides(overrides) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) { memory = { ...overrides }; return; }
  await put(PATHNAME, JSON.stringify({ overrides }), { access: 'private', allowOverwrite: true, cacheControlMaxAge: 60, contentType: 'application/json' });
}

module.exports = { loadOverrides, saveOverrides };
