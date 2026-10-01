const assert = require('node:assert/strict');
const test = require('node:test');
const { lossesFromCsv } = require('../lib/small-bottle-losses');

test('シートの「小瓶ロス」から、起点の日〜今日のロスをプログラムごとに合計する', () => {
  const csv = [
    '小瓶ロス（割れ・こぼれ・瓶詰めミスなど）,,,,',
    '日付は 2026/10/01 のように入れてください,,,,',
    '日付,プログラム,本数,理由,記入者（任意）',
    '2026/09/28,vol.8-4,9,起点より前,',
    '2026/10/01,vol.8-4,2,割れ,',
    '2026-10-02,vol.8-4,1本,こぼれ,田中',
    '2026/10/02,vol.3-1,3,,',
    '2026/10/09,vol.3-1,5,先の日付,',
    ',vol.3-1,4,日付なし,',
    '2026/10/02,,4,プログラムなし,',
  ].join('\n');
  assert.deepEqual(lossesFromCsv(csv, '2026-09-29', '2026-10-02'), { 'vol.8-4': 3, 'vol.3-1': 3 });
  assert.throws(() => lossesFromCsv('a,b\n1,2', '2026-09-29', '2026-10-02'), /見出し/);
});
