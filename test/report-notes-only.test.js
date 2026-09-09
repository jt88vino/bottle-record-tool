const assert = require('node:assert/strict');
const test = require('node:test');

const configStorePath = require.resolve('../lib/config-store');
require.cache[configStorePath] = {
  id: configStorePath,
  filename: configStorePath,
  loaded: true,
  exports: {
    loadConfig: async () => ({
      title: '瓶詰め記録',
      smallBottleFactor: 7.5,
      groups: [{ rows: [
        { id: 'vol-1', label: 'vol.1-1', wineName: 'テストワイン', importerName: '' },
        { id: 'vol-13', label: 'vol.13-1', wineName: '対象外ワイン', importerName: '' },
      ] }],
    }),
  },
};

const reportHandler = require('../api/report');

function makeResponse() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('瓶詰め記録の入力条件', async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  process.env.GOOGLE_APPS_SCRIPT_URL = 'https://example.test/sheets';
  process.env.GOOGLE_SHEETS_SYNC_SECRET = 'test-secret';
  process.env.SLACK_WEBHOOK_URL = 'https://example.test/slack';

  t.after(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  await t.test('備考だけでもスプレッドシートとSlackへ送れる', async () => {
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/sheets')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200 };
    };
    const response = makeResponse();

    await reportHandler({ method: 'POST', body: { type: 'bottling', date: '2026-08-28', recorderName: '田中', notes: '破損ボトルを確認', items: [] } }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, { ok: true, sheetsSaved: true });
    assert.equal(calls.length, 2);
    const sheetPayload = JSON.parse(calls[0].options.body);
    assert.equal(sheetPayload.items.length, 1);
    assert.equal(sheetPayload.items[0].bottles, 0);
    assert.equal(sheetPayload.items[0].program, '');
    const slackPayload = JSON.parse(calls[1].options.body);
    assert.match(slackPayload.text, /本数入力なし（備考のみの記録）/);
    assert.match(slackPayload.text, /破損ボトルを確認/);
  });

  await t.test('本数も備考も空なら送れない', async () => {
    let fetchCount = 0;
    global.fetch = async () => { fetchCount += 1; };
    const response = makeResponse();

    await reportHandler({ method: 'POST', body: { type: 'bottling', date: '2026-08-28', recorderName: '田中', notes: '   ', items: [] } }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.payload.error, /使用本数または備考/);
    assert.equal(fetchCount, 0);
  });

  await t.test('通常の本数入力も従来どおり送れる', async () => {
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/sheets')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200 };
    };
    const response = makeResponse();

    await reportHandler({ method: 'POST', body: { type: 'bottling', date: '2026-08-28', recorderName: '田中', notes: '', items: [{ id: 'vol-1', bottles: 2 }] } }, response);

    assert.equal(response.statusCode, 200);
    const sheetPayload = JSON.parse(calls[0].options.body);
    assert.equal(sheetPayload.items[0].bottles, 2);
    assert.equal(sheetPayload.items[0].smallBottles, 15);
  });

  await t.test('Vol.1〜12の販売出荷をスプレッドシートとSlackへ送れる', async () => {
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/sheets')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200 };
    };
    const response = makeResponse();

    await reportHandler({ method: 'POST', body: { type: 'shipping', date: '2026-09-09', recorderName: '田中', notes: '注文番号A-001', items: [{ id: 'vol-1', bottles: 3 }] } }, response);

    assert.equal(response.statusCode, 200);
    const sheetPayload = JSON.parse(calls[0].options.body);
    assert.equal(sheetPayload.type, 'shipping');
    assert.equal(sheetPayload.items[0].bottles, 3);
    const slackPayload = JSON.parse(calls[1].options.body);
    assert.match(slackPayload.text, /ボトル販売出荷記録/);
    assert.match(slackPayload.text, /合計\*: 3本/);
  });

  await t.test('Vol.13以降は販売出荷として送れない', async () => {
    let fetchCount = 0;
    global.fetch = async () => { fetchCount += 1; };
    const response = makeResponse();

    await reportHandler({ method: 'POST', body: { type: 'shipping', date: '2026-09-09', recorderName: '田中', notes: '', items: [{ id: 'vol-13', bottles: 1 }] } }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(fetchCount, 0);
  });
});
