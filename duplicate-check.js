// 二重送信の確認：送ろうとしている記録と同じ内容（種類・日付・銘柄ごとの本数）を、
// この端末で送った記録（送信中に結果が分からなくなったものも含む）と、シートの履歴から探す。
(function (root) {
  const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

  function itemsKey(items) {
    return items.map((item) => `${String(item.label || item.program || '').trim().toLowerCase()}:${Number(item.bottles)}`).sort().join('|');
  }
  function reportKey(report) { return `${report.type}|${report.date}|${itemsKey(report.items)}`; }

  // sent: この端末で送った記録 [{ key, at, status: 'sent' | 'unknown' }]
  function findSent(report, sent, now) {
    if (!report.items.length) return null;
    const key = reportKey(report);
    return (sent || []).filter((entry) => entry && entry.key === key && now - entry.at < KEEP_MS).sort((a, b) => b.at - a.at)[0] || null;
  }

  // history: シートの履歴（date, program, bottles, recorderName）。送る銘柄がすべて同じ日・同じ本数で履歴にあれば、同じ記録とみなす
  function findInHistory(report, history) {
    if (!report.items.length || !Array.isArray(history)) return null;
    const sameDay = history.filter((row) => row.date === report.date);
    const recorders = new Set();
    for (const item of report.items) {
      const label = String(item.label || '').trim().toLowerCase();
      const hit = sameDay.find((row) => String(row.program || '').trim().toLowerCase() === label && Number(row.bottles) === Number(item.bottles)
        && (!report.recorderName || !row.recorderName || row.recorderName === report.recorderName || row.recorderName === '未入力'));
      if (!hit) return null;
      if (hit.recorderName) recorders.add(hit.recorderName);
    }
    return { recorders: [...recorders] };
  }

  function prune(sent, now) { return (sent || []).filter((entry) => entry && now - entry.at < KEEP_MS).slice(-50); }

  const api = { reportKey, findSent, findInHistory, prune };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuplicateCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
