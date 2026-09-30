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
  const isStock = String(url).includes('1oMgDnV4');
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
const stock = (stockCount, bottled) => [
  'プログラム在庫,,,,,,', ',,,,,,',
  'プログラム,ワイン名,基準在庫,入荷累計,瓶詰め使用,販売出荷,現在在庫',
  `vol.8-4,カヤ,19本,18本,${bottled}本,0本,${stockCount}本`,
].join('\n');

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
  const needBefore = kaya(first).need;

  // 10/1：レポートを貼り替え、10/4着の注文が出て消えた。10/2 の出荷には残る
  scheduleCsv = csv(Array(5).fill('2026/10/20,7'));
  const second = await call('2026-10-01');
  assert.equal(shipped(second, '2026-10-02').count, 30 + 15);
  assert.deepEqual(second.days.find((d) => d.date === '2026-10-02').fromLedger.map((e) => [e.date, e.count]), [['2026-10-04', 15]]);
  // 必要な本数は、9/30 に出荷した 10/1着の分（75件）だけ減る。消えた 15件は減らない
  const shippedOn930 = 75;
  const smallBefore = kaya(first).smallBottles;
  assert.equal(kaya(second).smallBottles, smallBefore - shippedOn930);
  assert.equal(kaya(second).need, needBefore); // 今後の件数も小瓶も同じだけ減るので、必要な本数は変わらない
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
