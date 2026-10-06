const test = require('node:test');
const assert = require('node:assert');
const { reportKey, findSent, findInHistory, prune } = require('../duplicate-check');

const report = { type: 'bottling', date: '2026-10-06', recorderName: '喜多', items: [{ label: 'vol.1-2', bottles: 1 }, { label: 'vol.2-1', bottles: 5 }] };

test('この端末で送った同じ内容を見つける（銘柄の順番は問わない）', () => {
  const now = Date.now();
  const sent = [{ key: reportKey({ ...report, items: [...report.items].reverse() }), at: now - 26000, status: 'sent' }];
  assert.equal(findSent(report, sent, now).status, 'sent');
  assert.equal(findSent({ ...report, date: '2026-10-07' }, sent, now), null);
  assert.equal(findSent({ ...report, items: [{ label: 'vol.1-2', bottles: 2 }, { label: 'vol.2-1', bottles: 5 }] }, sent, now), null);
  assert.equal(findSent(report, sent, now + 4 * 86400000), null);
  assert.equal(findSent({ ...report, items: [] }, sent, now), null);
});

test('履歴に同じ日・同じ本数がそろっていれば知らせる', () => {
  const history = [
    { date: '2026-10-06', program: 'vol.1-2', bottles: 1, recorderName: '喜多' },
    { date: '2026-10-06', program: 'vol.2-1', bottles: 5, recorderName: '喜多' },
  ];
  assert.deepEqual(findInHistory(report, history), { recorders: ['喜多'] });
  assert.equal(findInHistory(report, history.slice(0, 1)), null);
  assert.equal(findInHistory({ ...report, recorderName: '鈴木' }, history), null);
  assert.equal(findInHistory(report, null), null);
});

test('古い送信の控えは捨てる', () => {
  const now = Date.now();
  assert.equal(prune([{ key: 'a', at: now - 4 * 86400000 }, { key: 'b', at: now }], now).length, 1);
});
