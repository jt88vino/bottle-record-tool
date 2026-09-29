const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSchedule, rowsFromCsv, shipDateFor, planLabel, parseDate, toKey } = require('../lib/shipment-schedule');

const ship = (date, label) => toKey(shipDateFor(parseDate(date), label));

test('定期回数はひとつ先の数字にし、13以上はPRO', () => {
  assert.equal(planLabel(1 + 1), 'Vol.2');
  assert.equal(planLabel(11 + 1), 'Vol.12');
  assert.equal(planLabel(12 + 1), 'PRO');
  assert.equal(planLabel(56 + 1), 'PRO');
});

test('Volは平日ならその日、土日なら直前の金曜日に出荷', () => {
  assert.equal(ship('2026/10/07', 'Vol.3'), '2026-10-07'); // 水
  assert.equal(ship('2026/10/10', 'Vol.3'), '2026-10-09'); // 土 → 金
  assert.equal(ship('2026/10/11', 'Vol.3'), '2026-10-09'); // 日 → 金
  assert.equal(ship('2026/11/01', 'Vol.3'), '2026-10-30'); // 月をまたぐ日曜 → 前月の金曜
});

test('PROは配送予定日の月の27日、土日なら直前の金曜日', () => {
  assert.equal(ship('2026/10/04', 'PRO'), '2026-10-27'); // 10/27 は火曜
  assert.equal(ship('2026/10/31', 'PRO'), '2026-10-27');
  assert.equal(ship('2026/03/05', 'PRO'), '2026-03-27'); // 金曜
  assert.equal(ship('2026/06/10', 'PRO'), '2026-06-26'); // 6/27 は土曜 → 金曜
  assert.equal(ship('2026/12/01', 'PRO'), '2026-12-25'); // 12/27 は日曜 → 金曜
});

test('CSVから出荷日ごとの件数を集計する', () => {
  const csv = [
    '"次回配送予定日","定期回数"',
    '"2026/10/10 0:00","1"', // 土 → 10/9 Vol.2
    '"2026/10/11 0:00","1"', // 日 → 10/9 Vol.2
    '"2026/10/09 0:00","5"', // 金 → 10/9 Vol.6
    '"2026/10/09 0:00","12"', // PRO → 10/27
    '"2026/10/20 10:57","30"', // PRO → 10/27（時刻つきも読む）
  ].join('\n');
  const result = buildSchedule(rowsFromCsv(csv));
  assert.equal(result.total, 5);
  assert.deepEqual(result.days.map((d) => [d.date, d.weekday, d.total]), [
    ['2026-10-09', '金', 3],
    ['2026-10-27', '火', 2],
  ]);
  assert.deepEqual(result.days[0].plans, [{ label: 'Vol.2', count: 2 }, { label: 'Vol.6', count: 1 }]);
  assert.deepEqual(result.days[0].deliveryDates.map((d) => d.date), ['2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepEqual(result.days[0].shifted.map((d) => [d.date, d.weekday, d.count]), [['2026-10-10', '土', 1], ['2026-10-11', '日', 1]]);
  assert.equal(result.days[0].pro, null);
  assert.deepEqual(result.days[1].pro, { count: 2, from: '2026-10-09', to: '2026-10-20' });
  assert.deepEqual(result.days[1].shifted, []);
  assert.deepEqual(result.plans, [{ label: 'Vol.2', count: 2 }, { label: 'Vol.6', count: 1 }, { label: 'PRO', count: 2 }]);
  assert.equal(result.skipped.length, 0);
});

test('列の順番が違っても読め、壊れた行は数えずに報告する', () => {
  const csv = '定期回数,次回配送予定日\n3,2026/10/07\n,2026/10/07\nx,2026/10/07\n4,日付なし\n';
  const result = buildSchedule(rowsFromCsv(csv));
  assert.equal(result.total, 1);
  assert.equal(result.skipped.length, 3);
});

test('必要な列がなければエラーにする', () => {
  assert.throws(() => rowsFromCsv('日付,回数\n2026/10/07,1\n'), /列が見つかりません/);
});
