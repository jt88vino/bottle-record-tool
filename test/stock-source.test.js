const assert = require('node:assert/strict');
const test = require('node:test');
const { stockItemsFromSource, lossesFromSource } = require('../lib/stock-source');

const data = {
  ok: true,
  stock: [
    { id: 'vol.8-4', name: 'ウォルファー・エステイト カヤ', base: 19, incoming: 54, bottled: 37, sold: 0, stock: 36 },
    { id: 'Pro.1', name: '（ワイン名未設定）', base: 0, incoming: 108, bottled: 0, sold: 0, stock: 108 },
    { id: '', name: '空の行', stock: 0 },
  ],
  losses: [
    { date: '2026-09-28', id: 'vol.8-4', count: 9 },   // 起点より前
    { date: '2026-10-01', id: 'vol.8-4', count: 2 },
    { date: '2026-10-02', id: 'vol.8-4', count: 1 },
    { date: '2026-10-02', id: 'vol.3-1', count: 3 },
    { date: '2026-10-09', id: 'vol.3-1', count: 5 },   // 先の日付
    { date: 'x', id: 'vol.3-1', count: 4 },
  ],
};

test('瓶詰め記録のスプレッドシートの「商品マスタ・在庫」を、発注アラートの形にする', () => {
  assert.deepEqual(stockItemsFromSource(data), [
    { id: 'vol.8-4', name: 'ウォルファー・エステイト カヤ', stock: 36, price: null, bottled: 37 },
    { id: 'Pro.1', name: '', stock: 108, price: null, bottled: 0 },
  ]);
});

test('「小瓶ロス」を、起点の日〜今日の分だけプログラムごとに合計する', () => {
  assert.deepEqual(lossesFromSource(data, '2026-09-29', '2026-10-02'), { 'vol.8-4': 3, 'vol.3-1': 3 });
  assert.deepEqual(lossesFromSource({ stock: [] }, '2026-09-29', '2026-10-02'), {});
});
