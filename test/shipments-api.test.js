// api/shipments.js のつなぎ方を、スプレッドシートと台帳をまねて確かめる
const assert = require('node:assert/strict');
const test = require('node:test');

const ledgerStore = require('../lib/ledger-store');
const configStore = require('../lib/config-store');

let stored = { deliveries: {} };
let saves = 0;
let loadFails = false;
ledgerStore.loadLedger = async () => (loadFails ? { deliveries: {}, loadFailed: true } : JSON.parse(JSON.stringify(stored)));
ledgerStore.saveLedger = async (ledger) => { saves += 1; stored = JSON.parse(JSON.stringify(ledger)); };
configStore.loadConfig = async () => { throw new Error('no config in tests'); };

let scheduleCsv = '';
let stockCsv = '';
let stockFails = false;
global.fetch = async (url) => {
  // 在庫と小瓶ロスは、瓶詰め記録のスプレッドシートに付けた Apps Script の窓口（JSON）から読む
  const isStock = String(url).includes('script.google.com/macros');
  if (isStock && stockFails) return new Response('error', { status: 500 });
  return new Response(isStock ? stockCsv : scheduleCsv, { status: 200 });
};

const handler = require('../api/shipments');
async function call(today) {
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'GET', query: { today } }, res);
  assert.equal(res.code, 200);
  return res.body;
}
const csv = (rows) => ['次回配送予定日,定期回数', ...rows].join('\n');
const stock = (stockCount, bottled, losses = [], { sold = 0, orders = [] } = {}) => JSON.stringify({
  ok: true,
  stock: [{ id: 'vol.8-4', leadDays: 1, name: 'カヤ', base: 19, incoming: 18, bottled, sold, stock: stockCount }],
  orders,
  losses,
});

test('注文が出て定期レポートから消えた分も、出荷日までは今後の出荷に入れる', async () => {
  stored = { deliveries: {} }; saves = 0; loadFails = false; stockFails = false;
  // 9/30：レポートは 10/4着から。10/4(日)着 Vol.8 ×15 は 10/2(金)出荷
  scheduleCsv = csv([...Array(15).fill('2026/10/04,7'), ...Array(5).fill('2026/10/20,7')]);
  stockCsv = stock(0, 37);
  const first = await call('2026-09-30');
  const kaya = (body) => body.stock.items.find((i) => i.id === 'vol.8-4');
  const shipped = (body, date) => (body.days.find((d) => d.date === date) || { plans: [] }).plans.find((p) => p.label === 'Vol.8');
  assert.ok(saves >= 1);
  assert.equal(shipped(first, '2026-10-02').count, 30 + 15); // 連絡の 10/3着 30件 + レポートの 10/4着 15件
  assert.ok(kaya(first));

  // 10/1：レポートを貼り替え、10/4着の注文が出て消えた。10/2 の出荷には残る
  scheduleCsv = csv(Array(5).fill('2026/10/20,7'));
  const second = await call('2026-10-01');
  assert.equal(shipped(second, '2026-10-02').count, 30 + 15);
  assert.deepEqual(second.days.find((d) => d.date === '2026-10-02').fromLedger.map((e) => [e.date, e.count]), [['2026-10-04', 15]]);
});

test('在庫のシートが読めなくても、台帳は控える', async () => {
  stored = { deliveries: {} }; saves = 0; loadFails = false; stockFails = true;
  scheduleCsv = csv(Array(3).fill('2026/10/06,7'));
  const body = await call('2026-09-30');
  assert.equal(body.stock, null);
  assert.ok(body.stockError);
  assert.equal(saves, 1);
  assert.deepEqual(stored.deliveries['2026-10-06'], { 'Vol.8': 3 });
});

test('台帳が読めなかった回は、保存せず、小瓶も数えない', async () => {
  stored = { deliveries: {} }; saves = 0; loadFails = true; stockFails = false;
  scheduleCsv = csv(Array(3).fill('2026/10/06,7'));
  stockCsv = stock(0, 37);
  const body = await call('2026-09-30');
  assert.equal(saves, 0);
  assert.equal(body.stock.smallBottlesUnavailable, true);
  assert.equal(body.stock.items.find((i) => i.id === 'vol.8-4').smallBottles, 0);
});

test('連絡の数を訂正したら、台帳の記録も訂正した数になる', async () => {
  // 前に 10/2着 Vol.8 を 54件 と控えていた
  stored = { deliveries: { '2026-10-02': { 'Vol.8': 54 } } }; saves = 0; loadFails = false; stockFails = false;
  scheduleCsv = csv(Array(3).fill('2026/10/06,7'));
  stockCsv = stock(0, 37);
  await call('2026-09-30');
  assert.equal(stored.deliveries['2026-10-02']['Vol.8'], require('../data/extra-deliveries.json').deliveries['2026-10-02']['Vol.8']);
});

test('在庫はボトルの実数（10/19）＋届いた発注−数えた日からの出荷件数÷7.5−販売出荷 で数え、届く前の発注は届く日から回す', async () => {
  // data/stock-count.json：vol.8-4 は 10/19 に 5本、販売出荷の累計 1本
  const count = require('../data/stock-count.json');
  assert.equal(count.date, '2026-10-19');
  assert.equal(count.stock['vol.8-4'], 5);
  stored = { deliveries: {} }; saves = 0; loadFails = false; stockFails = false;
  // 10/20着 4件（10/19出荷）・10/21着 5件（10/20出荷）・10/23着 30件（10/22出荷）・10/27着 40件（10/26出荷）
  scheduleCsv = csv([...Array(4).fill('2026/10/20,7'), ...Array(5).fill('2026/10/21,7'), ...Array(30).fill('2026/10/23,7'), ...Array(40).fill('2026/10/27,7')]);
  // 10/19 に6本発注（翌日10/20着）、10/21 に12本発注（10/22着）。シートの現在在庫（発注を含む）は使わない
  stockCsv = stock(99, 37, [], { sold: 2, orders: [{ date: '2026-10-19', id: 'vol.8-4', bottles: 6 }, { date: '2026-10-21', id: 'vol.8-4', bottles: 12 }] });
  const body = await call('2026-10-21');
  const kaya = body.stock.items.find((i) => i.id === 'vol.8-4');
  assert.equal(body.stock.countedOn, '2026-10-19');
  // (5 + 6 − 販売1) × 7.5 − 出荷9件 = 66 → ボトル8本と端数6本
  assert.equal(kaya.stock, 8);
  assert.equal(kaya.smallBottles, 6);
  // 10/22着の12本は、10/22の出荷から回す
  assert.deepEqual(kaya.arrivals, [{ date: '2026-10-22', bottles: 12 }]);
  assert.equal(kaya.incoming, 12);
  // 66 + 90 = 156 で 10/22 の30件・10/26 の40件（累計70）をまかなえる
  assert.equal(kaya.runsOutOn, null);
  assert.equal(kaya.shortage, 0);
});

test('届く前の出荷で足りない分は、あとで届いても足りないとする', async () => {
  // 前のレポートで 10/21着までは0件と分かっている（見積もりを入れない）
  stored = { deliveries: {}, seen: { from: '2026-09-29', to: '2026-10-21' } }; saves = 0; loadFails = false; stockFails = false;
  scheduleCsv = csv([...Array(70).fill('2026/10/22,7'), ...Array(5).fill('2026/10/27,7')]);
  // 10/22着の発注は 10/22 の出荷（10/23着）から。10/21 出荷の 70件は 10/19 の 5本＝37.5本 でしかまかなえない
  stockCsv = stock(99, 37, [], { sold: 1, orders: [{ date: '2026-10-21', id: 'vol.8-4', bottles: 30 }] });
  const kaya = (await call('2026-10-21')).stock.items.find((i) => i.id === 'vol.8-4');
  assert.equal(kaya.stock, 5);
  assert.equal(kaya.runsOutOn, '2026-10-21');
  assert.equal(kaya.shortage, 5); // (70 − 37.5) ÷ 7.5 = 4.3 → 5本
});
