const test = require('node:test');
const assert = require('node:assert');
const { arrivalsFromSource, arrivalsOn, noteDate } = require('../lib/arrivals');

const data = {
  stock: [{ id: 'vol.7-2', name: 'シャトー・シマール', leadDays: 1 }, { id: 'vol.7-1', name: 'シャトー・ラグランジュ', leadDays: 2 }, { id: 'vol.11-1', name: 'はつゆき', leadDays: 5 }, { id: 'Pro.1', name: '（ワイン名未設定）', leadDays: null }],
  orders: [
    { date: '2026-10-06', id: 'vol.7-2', bottles: 12 },
    { date: '2026-10-06', id: 'vol.7-1', bottles: 6 },
    { date: '2026-10-05', id: 'vol.11-1', bottles: 48 },
    { date: '2026-10-05', id: 'Pro.1', bottles: 120 },
    { date: '2026-09-30', id: 'vol.7-2', bottles: 21, note: '10/2着' },
    { date: '2026-10-09', id: 'vol.7-2', bottles: 3 },
  ],
};

test('記入日＋I列の日数で届く日を出す（備考の日付があればそちら）', () => {
  const a = arrivalsFromSource(data);
  assert.deepEqual(arrivalsOn(a, '2026-10-07').map((r) => [r.id, r.bottles]), [['vol.7-2', 12]]);
  assert.deepEqual(arrivalsOn(a, '2026-10-08').map((r) => [r.id, r.bottles]), [['vol.7-1', 6]]);
  assert.deepEqual(arrivalsOn(a, '2026-10-02').map((r) => [r.id, r.bottles]), [['vol.7-2', 21]]);
  assert.equal(a.some((r) => r.id === 'Pro.1'), false); // 日数がなく備考もなければ出さない
});

test('土日・祝日に届く分は次の出勤日に（10/9金の1day→10/10土→10/12祝→10/13）', () => {
  const a = arrivalsFromSource(data);
  assert.deepEqual(arrivalsOn(a, '2026-10-13').map((r) => [r.id, r.bottles, r.moved]), [['vol.7-2', 3, true], ['vol.11-1', 48, true]]);
});

test('備考の日付は年をまたいでも読む', () => {
  assert.equal(noteDate('1/5着', '2026-12-28'), '2027-01-05');
  assert.equal(noteDate('なし', '2026-12-28'), null);
});
