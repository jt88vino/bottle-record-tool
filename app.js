const forms = { bottling: document.querySelector('#bottling-form'), incoming: document.querySelector('#incoming-form'), shipping: document.querySelector('#shipping-form') };
const tabs = { bottling: document.querySelector('#bottling-tab'), incoming: document.querySelector('#incoming-tab'), shipping: document.querySelector('#shipping-tab') };
const groupPanels = { bottling: document.querySelector('#volume-groups'), incoming: document.querySelector('#incoming-volume-groups'), shipping: document.querySelector('#shipping-volume-groups') };
const dateInputs = { bottling: document.querySelector('#record-date'), incoming: document.querySelector('#incoming-date'), shipping: document.querySelector('#shipping-date') };
const errorBox = document.querySelector('#form-error');
const dialog = document.querySelector('#confirm-dialog');
const preview = document.querySelector('#report-preview');
const confirmButton = document.querySelector('#confirm-button');
const toast = document.querySelector('#toast');
const deleteDialog = document.querySelector('#delete-dialog');
let appConfig; let pendingReport; let pendingDelete;

function formatNumber(value) { return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value); }
function escapeHtml(value = '') { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }); }
function setError(message = '') { errorBox.hidden = !message; errorBox.textContent = message; }
function showToast(message) { toast.textContent = message; toast.classList.add('visible'); window.setTimeout(() => toast.classList.remove('visible'), 5500); }
function rowById(id) { return appConfig.groups.flatMap((group) => group.rows).find((row) => row.id === id); }
function isShippingProgram(label = '') { const match = String(label).match(/^vol\.(\d+)(?:-|$)/i); return Boolean(match && Number(match[1]) >= 1 && Number(match[1]) <= 12); }
function shippingGroups() { return appConfig.groups.map((group) => ({ ...group, rows: group.rows.filter((row) => isShippingProgram(row.label)) })).filter((group) => group.rows.length); }
function populateRecorderOptions() { const names = Array.isArray(appConfig.recorderNames) ? appConfig.recorderNames : []; ['#bottling-recorder', '#incoming-recorder', '#shipping-recorder'].forEach((selector) => { const select = document.querySelector(selector); select.replaceChildren(new Option(selector === '#incoming-recorder' ? '未入力でOK' : '選択してください', ''), ...names.map((name) => new Option(name, name))); }); }

function makeGroups(target, prefix, kind, sourceGroups = appConfig.groups) {
  target.replaceChildren();
  sourceGroups.forEach((group, groupIndex) => {
    const detail = document.createElement('details'); detail.open = groupIndex === 0;
    const isIncoming = kind === 'incoming'; const action = isIncoming ? '入荷' : kind === 'shipping' ? '出荷' : '使用';
    detail.innerHTML = `<summary><span>${escapeHtml(group.label)}</span><span class="group-count" hidden></span></summary><div class="volume-inputs">${group.rows.map((row) => `<div class="wine-input ${isIncoming ? 'incoming-wine-input' : ''}"><label for="${prefix}${escapeHtml(row.id)}"><span>${escapeHtml(row.label)}</span><small>${escapeHtml(row.wineName || 'ワイン名未設定')}${isIncoming ? `<em>${escapeHtml(row.importerName || 'インポーター未設定')}</em>` : ''}</small></label><input id="${prefix}${escapeHtml(row.id)}" name="${escapeHtml(row.id)}" type="number" inputmode="numeric" min="0" max="9999" step="1" placeholder="0" aria-label="${escapeHtml(row.label)}の${action}本数" />${isIncoming ? `<label class="item-note-field" hidden for="note-${prefix}${escapeHtml(row.id)}"><span>銘柄別備考（任意）</span><textarea id="note-${prefix}${escapeHtml(row.id)}" data-item-note="${escapeHtml(row.id)}" rows="2" maxlength="1000"></textarea></label>` : ''}</div>`).join('')}</div>`;
    target.append(detail);
  });
}
function createInputs() { makeGroups(groupPanels.bottling, 'b-', 'bottling'); makeGroups(groupPanels.incoming, 'i-', 'incoming'); makeGroups(groupPanels.shipping, 's-', 'shipping', shippingGroups()); }
function itemsFrom(target) { const notes = new Map([...target.querySelectorAll('[data-item-note]')].map((input) => [input.dataset.itemNote, input.value.trim()])); return [...target.querySelectorAll('input[type="number"]')].map((input) => ({ id: input.name, bottles: Number(input.value || 0) })).filter((item) => Number.isInteger(item.bottles) && item.bottles > 0).map((item) => ({ ...item, ...rowById(item.id), itemNote: notes.get(item.id) || '', smallBottles: item.bottles * appConfig.smallBottleFactor })); }
function getReport(type) { const items = itemsFrom(groupPanels[type]); const total = items.reduce((sum, item) => sum + item.bottles, 0); return { type, date: dateInputs[type].value, recorderName: document.querySelector(`#${type}-recorder`).value.trim(), notes: document.querySelector(`#${type}-notes`).value.trim(), supplier: type === 'incoming' ? document.querySelector('#incoming-supplier').value.trim() : '', items, totalBottles: total, totalSmallBottles: type === 'bottling' ? total * appConfig.smallBottleFactor : 0 }; }
// 閉じたVolでも、入力した銘柄数と本数が見出しで分かるようにする
function updateGroupCounts(type) { groupPanels[type].querySelectorAll(':scope > details').forEach((detail) => { const counts = [...detail.querySelectorAll('input[type="number"]')].map((input) => Number(input.value || 0)).filter((n) => Number.isInteger(n) && n > 0); const badge = detail.querySelector('.group-count'); badge.hidden = !counts.length; badge.textContent = counts.length ? `${counts.length}銘柄 ${formatNumber(counts.reduce((sum, n) => sum + n, 0))}本` : ''; }); }
// 入荷の銘柄別備考は、本数を入れた銘柄だけに出す（書きかけの備考は消さない）
function updateItemNotes(type) { groupPanels[type].querySelectorAll('.item-note-field').forEach((field) => { const bottles = Number(field.closest('.wine-input').querySelector('input[type="number"]').value || 0); field.hidden = !(bottles > 0 || field.querySelector('textarea').value.trim()); }); }
function updateSummary(type) { updateGroupCounts(type); updateItemNotes(type); const report = getReport(type); if (type === 'bottling') { document.querySelector('#total-bottles').textContent = formatNumber(report.totalBottles); document.querySelector('#total-small-bottles').textContent = formatNumber(report.totalSmallBottles); return; } document.querySelector(`#${type}-total-bottles`).textContent = formatNumber(report.totalBottles); document.querySelector(`#${type}-total-wines`).textContent = formatNumber(report.items.length); }

function reportText(report) {
  const lines = report.items.map((item) => report.type === 'incoming' ? `・${item.label}｜${item.wineName}: ${formatNumber(item.bottles)}本${item.itemNote ? `\n  銘柄別備考: ${item.itemNote}` : ''}` : report.type === 'shipping' ? `・${item.label}｜${item.wineName}: ${formatNumber(item.bottles)}本` : `・${item.label}｜${item.wineName}: ${formatNumber(item.bottles)}本 → 小瓶 ${formatNumber(item.smallBottles)}本`).join('\n');
  const itemSummary = lines || '・本数入力なし（備考のみの記録）';
  if (report.type === 'incoming') return `入荷記録\n記入日: ${report.date}\n記入者: ${report.recorderName || '未入力'}\n\n入荷ワイン\n${itemSummary}\n\n合計: ${formatNumber(report.totalBottles)}本${report.supplier ? `\n仕入先: ${report.supplier}` : ''}${report.notes ? `\n\n備考\n${report.notes}` : ''}`;
  if (report.type === 'shipping') return `ボトル販売出荷記録\n出荷日: ${report.date}\n記入者: ${report.recorderName}\n\n出荷ワイン\n${itemSummary}\n\n合計: ${formatNumber(report.totalBottles)}本${report.notes ? `\n\n備考\n${report.notes}` : ''}`;
  return `瓶詰め記録\n作業日: ${report.date}\n記入者: ${report.recorderName}\n\n使用ワイン\n${itemSummary}\n\n合計: 使用 ${formatNumber(report.totalBottles)}本 / 小瓶 ${formatNumber(report.totalSmallBottles)}本${report.notes ? `\n\n備考\n${report.notes}` : ''}`;
}
// ?tab=incoming&wine=vol.8-1 のように開くと、そのタブの該当銘柄の入力欄を開いて選ぶ（発注アラートから飛んでくる）
function openFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  // toString などの組み込みの名前でタブが全部消えないよう、自前のキーだけを受け付ける
  if (!tab || !Object.prototype.hasOwnProperty.call(forms, tab)) return;
  switchMode(tab);
  const wine = params.get('wine');
  if (!wine) return;
  const row = appConfig.groups.flatMap((group) => group.rows).find((item) => item.label === wine || item.id === wine);
  const prefix = { bottling: 'b-', incoming: 'i-', shipping: 's-' }[tab];
  const input = row && document.getElementById(`${prefix}${row.id}`);
  if (!input) return;
  const group = input.closest('details'); if (group) group.open = true;
  const box = input.closest('.wine-input'); if (box) box.classList.add('is-target');
  window.setTimeout(() => { input.scrollIntoView({ block: 'center', behavior: 'smooth' }); input.focus({ preventScroll: true }); }, 50);
}
// 入荷などを記録したら、同じブラウザで開いている出荷ページに在庫の読み直しを知らせる
function notifyStockChanged(type) { try { window.localStorage.setItem('stockChangedAt', `${Date.now()}:${type}`); } catch { /* 保存できなくても記録には影響しない */ } }
let currentMode = 'bottling';
function switchMode(mode) { currentMode = mode; Object.keys(forms).forEach((type) => { const active = type === mode; forms[type].hidden = !active; tabs[type].classList.toggle('active', active); tabs[type].setAttribute('aria-selected', String(active)); }); setError(); loadHistory(mode); }
function openConfirm(report) { setError(); if (!report.date) return setError(report.type === 'shipping' ? '出荷日を入力してください。' : report.type === 'incoming' ? '記入日を入力してください。' : '作業日を入力してください。'); if (!report.recorderName && report.type !== 'incoming') return setError('記入者名を入力してください。'); if (!report.items.length && (report.type !== 'bottling' || !report.notes)) return setError(report.type === 'shipping' ? '出荷したワインと本数を入力してください。' : report.type === 'incoming' ? '入荷したワインと本数を入力してください。' : '使用本数または備考を入力してください。'); pendingReport = report; preview.textContent = reportText(report); showDuplicateWarning(report); dialog.showModal(); }
// 二重送信の確認：同じ内容をもう送っていれば、送る前に知らせる（それでも送れる）
function sentReports() { try { return JSON.parse(window.localStorage.getItem('sentReports') || '[]'); } catch { return []; } }
function saveSentReports(list) { try { window.localStorage.setItem('sentReports', JSON.stringify(DuplicateCheck.prune(list, Date.now()))); } catch { /* 保存できなくても送信には影響しない */ } }
function markSent(report, status) { const key = DuplicateCheck.reportKey(report); const list = sentReports().filter((entry) => !(entry.key === key && entry.at === report.sentAt)); list.push({ key, at: report.sentAt, status }); saveSentReports(list); }
function duplicateMessage(report) {
  const key = DuplicateCheck.reportKey(report);
  if (report.items.length && readQueue().some((entry) => DuplicateCheck.reportKey(entry.report) === key)) return '同じ内容を送信中です。';
  const sent = DuplicateCheck.findSent(report, sentReports(), Date.now());
  if (sent) return sent.status === 'sent' ? `同じ内容を ${historyTime(sent.at)} に送信済みです。` : `同じ内容を ${historyTime(sent.at)} に送ろうとしています（届いたか不明）。先に履歴を確認してください。`;
  const cached = readHistoryCache(report.type);
  const hit = DuplicateCheck.findInHistory(report, cached && cached.items);
  if (hit) return `同じ日・同じ本数の記録が履歴にあります${hit.recorders.length ? `（${hit.recorders.join('・')}）` : ''}。`;
  return '';
}
function showDuplicateWarning(report) { const message = duplicateMessage(report); const box = document.querySelector('#duplicate-warning'); box.hidden = !message; box.textContent = message ? `⚠️ ${message}二重になりませんか？` : ''; document.querySelector('#dialog-title').textContent = message ? '二重送信ではありませんか？' : 'この内容で送りますか？'; confirmButton.textContent = message ? 'それでも送信する' : '記録を送信する'; confirmButton.classList.toggle('danger-button', Boolean(message)); confirmButton.classList.toggle('primary-button', !message); }
function formatHistory(item, type) { const date = String(item.date || '').replaceAll('-', '/'); const notesOnly = type === 'bottling' && !item.program && !item.wineName && Number(item.bottles) === 0; const notes = [item.itemNote ? `銘柄別備考：${escapeHtml(item.itemNote)}` : '', item.notes ? `備考：${escapeHtml(item.notes)}` : ''].filter(Boolean).map((note) => `<p>${note}</p>`).join(''); const sub = notesOnly ? '本数入力なし' : type === 'incoming' ? `入荷 ${formatNumber(item.bottles)}本${item.supplier ? ` ／ ${escapeHtml(item.supplier)}` : ''}` : type === 'shipping' ? `出荷 ${formatNumber(item.bottles)}本` : `使用 ${formatNumber(item.bottles)}本 → 小瓶 ${formatNumber(item.smallBottles)}本`; const program = notesOnly ? '備考のみの記録' : item.program; const wineName = notesOnly ? '' : item.wineName; const label = notesOnly ? '備考のみの記録' : `${item.program}｜${item.wineName}`; return `<article class="history-item"><div><strong>${escapeHtml(program)}</strong><span>${escapeHtml(wineName)}</span></div><div class="history-meta"><span>${date} ・ ${escapeHtml(item.recorderName || '記入者未入力')}</span><b>${sub}</b></div>${notes}<button class="history-delete" type="button" data-history="${type}" data-row-number="${Number(item.rowNumber)}" data-label="${escapeHtml(label)}">削除</button></article>`; }
// ── 履歴の読み込み ─────────────────────────────
// Apps Script は要求を1本ずつしか処理しないため、同時に何本も投げると順番待ちで数十秒かかる。
// そこで (1) 見えているタブの分だけ読む (2) 前回の結果を先に表示して裏で更新する (3) 時間切れは1回だけやり直す
// (4) 読めなかったときは前回の表示を消さず「記録なし」とも出さない、の4点で待ち時間を減らす。
const historyState = { bottling: {}, incoming: {}, shipping: {} };
const HISTORY_FRESH_MS = 60 * 1000;
function historyCacheKey(type) { return `history:${type}`; }
function readHistoryCache(type) { try { const raw = window.localStorage.getItem(historyCacheKey(type)); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function writeHistoryCache(type, items) { try { window.localStorage.setItem(historyCacheKey(type), JSON.stringify({ items, savedAt: Date.now() })); } catch { /* 保存できなくても表示には影響しない */ } }
function historyTime(ms) { return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)); }
// fresh=false（前回の表示や読み込み失敗時）は、送信直後に差し込んだ「記録済み」の行を残す
function renderHistory(type, items, status = '', { fresh = true } = {}) {
  const panel = document.querySelector(`#${type}-history`);
  const pending = fresh ? '' : [...panel.querySelectorAll('.is-just-saved')].map((el) => el.outerHTML).join('');
  // 「記録はありません」は、最新の一覧が本当に空だったときだけ出す
  const list = items.length ? items.map((item) => formatHistory(item, type)).join('') : (fresh ? '<p class="history-empty">直近2日間の記録はありません。</p>' : '');
  panel.innerHTML = `${status ? `<p class="history-status">${status}</p>` : ''}${pending}${list}`;
  if (appConfig) { const queued = queueCards(type); if (queued) { panel.querySelector('.history-empty')?.remove(); panel.insertAdjacentHTML('afterbegin', queued); } }
}
async function fetchHistoryOnce(type, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/history?type=${type}`, { cache: 'no-store', signal: controller.signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.items)) throw new Error(result.error || '履歴を読み込めませんでした。');
    return result.items;
  } finally { window.clearTimeout(timer); }
}
async function loadHistory(type, { force = false } = {}) {
  const state = historyState[type];
  if (state.loading) return state.loading;
  if (!force && state.loadedAt && Date.now() - state.loadedAt < HISTORY_FRESH_MS) return undefined;
  const cached = readHistoryCache(type);
  const panel = document.querySelector(`#${type}-history`);
  if (cached && Array.isArray(cached.items)) renderHistory(type, cached.items, `${historyTime(cached.savedAt)} 時点の表示です。最新を読み込み中…`, { fresh: false });
  else if (!panel.querySelector('.is-just-saved')) panel.innerHTML = '<p class="history-empty">履歴を読み込み中です。</p>';
  state.loading = (async () => {
    let items = null;
    for (const [attempt, timeoutMs] of [[1, 20000], [2, 25000]]) {
      try { items = await fetchHistoryOnce(type, timeoutMs); break; } catch (error) {
        if (attempt === 1) await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }
    }
    if (items) {
      writeHistoryCache(type, items);
      state.loadedAt = Date.now();
      renderHistory(type, items);
    } else if (cached && Array.isArray(cached.items)) {
      renderHistory(type, cached.items, `最新の履歴を読み込めませんでした（${historyTime(cached.savedAt)} 時点の表示です）。少し待って「更新」を押してください。`, { fresh: false });
    } else {
      renderHistory(type, [], '履歴の読み込みに時間がかかっています。少し待って「更新」を押してください。', { fresh: false });
    }
  })().finally(() => { state.loading = null; });
  return state.loading;
}
// 送信が成功したら、履歴の読み直しを待たずに一番上へ表示しておく（行番号が分かるまで削除ボタンは出さない）
function showJustSaved(report) {
  const panel = document.querySelector(`#${report.type}-history`);
  const rows = report.items.length ? report.items : [{ label: '', wineName: '', bottles: 0 }];
  const html = rows.map((item) => {
    const sub = report.type === 'incoming' ? `入荷 ${formatNumber(item.bottles)}本` : report.type === 'shipping' ? `出荷 ${formatNumber(item.bottles)}本` : item.label ? `使用 ${formatNumber(item.bottles)}本 → 小瓶 ${formatNumber(item.bottles * appConfig.smallBottleFactor)}本` : '備考のみの記録';
    return `<article class="history-item is-just-saved"><div><strong>${escapeHtml(item.label || '備考のみの記録')}</strong><span>${escapeHtml(item.wineName || '')}</span></div><div class="history-meta"><span>${String(report.date).replaceAll('-', '/')} ・ ${escapeHtml(report.recorderName)}</span><b>${sub}</b></div><p class="history-pending">記録済み・履歴に反映中…</p></article>`;
  }).join('');
  panel.querySelector('.history-empty')?.remove();
  panel.insertAdjacentHTML('afterbegin', html);
}

Object.keys(forms).forEach((type) => { forms[type].addEventListener('input', () => updateSummary(type)); forms[type].addEventListener('submit', (event) => { event.preventDefault(); openConfirm(getReport(type)); }); tabs[type].addEventListener('click', () => switchMode(type)); });
document.querySelector('#back-button').addEventListener('click', () => dialog.close());
document.querySelectorAll('.history-refresh').forEach((button) => button.addEventListener('click', () => loadHistory(button.dataset.history, { force: true })));
document.addEventListener('click', (event) => { const button = event.target.closest('.history-delete'); if (!button) return; pendingDelete = { type: button.dataset.history, rowNumber: Number(button.dataset.rowNumber) }; document.querySelector('#delete-preview').textContent = button.dataset.label; deleteDialog.showModal(); });
document.querySelector('#delete-cancel').addEventListener('click', () => deleteDialog.close());
document.querySelector('#delete-confirm').addEventListener('click', async () => { if (!pendingDelete) return; const button = document.querySelector('#delete-confirm'); button.disabled = true; button.textContent = '削除中…'; try { const response = await fetch(`/api/history?type=${pendingDelete.type}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowNumber: pendingDelete.rowNumber }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '履歴を削除できませんでした。'); deleteDialog.close(); loadHistory(pendingDelete.type, { force: true }); notifyStockChanged(pendingDelete.type); showToast('履歴を削除しました。'); pendingDelete = null; } catch (error) { showToast(error.message || '履歴を削除できませんでした。'); } finally { button.disabled = false; button.textContent = '削除する'; } });
// 送信は待たせない：押したらすぐ閉じて次の入力へ。送信は裏で行い、届くまで履歴の上に「送信中」を出す。
// 端末に控えを残すので、通信が遅い・途中で閉じた場合も、次に開いたときに続きから送る（先に履歴を見て二重にしない）。
confirmButton.addEventListener('click', () => {
  if (!pendingReport) return;
  const report = pendingReport; pendingReport = null;
  report.sentAt = Date.now(); markSent(report, 'unknown');
  const queue = readQueue(); queue.push({ id: `${report.sentAt}-${Math.random().toString(36).slice(2, 7)}`, report, state: 'sending', tries: 0 }); writeQueue(queue);
  dialog.close(); forms[report.type].reset(); dateInputs[report.type].value = today(); updateSummary(report.type);
  confirmButton.classList.add('primary-button'); confirmButton.classList.remove('danger-button'); confirmButton.textContent = '記録を送信する';
  showToast('送信しています。このまま次の入力ができます。');
  renderQueue(); processQueue();
});
const QUEUE_KEY = 'sendQueue';
const SEND_TIMEOUT_MS = 70000;
const inFlight = new Set();
function readQueue() { try { return JSON.parse(window.localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return memoryQueue; } }
let memoryQueue = [];
function writeQueue(queue) { memoryQueue = queue; try { window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* 保存できなくても、この画面を開いている間は送る */ } }
function updateEntry(id, patch) { const queue = readQueue().map((entry) => entry.id === id ? { ...entry, ...patch } : entry); writeQueue(queue); }
function removeEntry(id) { writeQueue(readQueue().filter((entry) => entry.id !== id)); }
function queueCards(type) {
  return readQueue().filter((entry) => entry.report.type === type).map((entry) => {
    const { report } = entry; const rows = report.items.length ? report.items : [{ label: '', wineName: '', bottles: 0 }];
    const status = entry.state === 'failed' ? `<p class="history-failed">送れませんでした：${escapeHtml(entry.error || '通信エラー')}</p>` : '<p class="history-pending">送信中…（このまま入力を続けられます）</p>';
    return rows.map((item) => { const sub = report.type === 'incoming' ? `入荷 ${formatNumber(item.bottles)}本` : report.type === 'shipping' ? `出荷 ${formatNumber(item.bottles)}本` : item.label ? `使用 ${formatNumber(item.bottles)}本 → 小瓶 ${formatNumber(item.bottles * appConfig.smallBottleFactor)}本` : '備考のみの記録'; return `<article class="history-item is-queued${entry.state === 'failed' ? ' is-failed' : ''}"><div><strong>${escapeHtml(item.label || '備考のみの記録')}</strong><span>${escapeHtml(item.wineName || '')}</span></div><div class="history-meta"><span>${String(report.date).replaceAll('-', '/')} ・ ${escapeHtml(report.recorderName || '未入力')}</span><b>${sub}</b></div>${status}</article>`; }).join('');
  }).join('');
}
function renderQueue() {
  const queue = readQueue(); const bar = document.querySelector('#send-queue');
  const failed = queue.filter((entry) => entry.state === 'failed'); const sending = queue.length - failed.length;
  bar.hidden = !queue.length;
  bar.className = `send-queue${failed.length ? ' is-failed' : ''}`;
  bar.innerHTML = failed.length
    ? `<span>⚠️ 未送信 ${failed.length}件</span><button type="button" data-queue="retry">もう一度送る</button><button type="button" data-queue="drop">取り消す</button>`
    : `<span class="send-spinner" aria-hidden="true"></span><span>送信中 ${sending}件（閉じても大丈夫）</span>`;
  Object.keys(forms).forEach((type) => { const panel = document.querySelector(`#${type}-history`); panel.querySelectorAll('.is-queued').forEach((el) => el.remove()); const html = appConfig ? queueCards(type) : ''; if (html) { panel.querySelector('.history-empty')?.remove(); panel.insertAdjacentHTML('afterbegin', html); } });
}
async function sendOnce(report) {
  const payload = { ...report, items: report.items.map(({ id, bottles, itemNote }) => ({ id, bottles, itemNote })) };
  delete payload.sentAt;
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true, signal: controller.signal });
    const result = await response.json().catch(() => ({}));
    if (result.sheetsSaved) return { ok: true, result };
    // 400 は入力の問題なので、やり直しても同じ。それ以外（混雑・時間切れ）は届いているかもしれない
    return { ok: false, definite: response.status === 400, error: result.error || '記録の送信に失敗しました。' };
  } catch { return { ok: false, definite: false, error: '通信に時間がかかっています。' }; } finally { window.clearTimeout(timer); }
}
// 結果が分からなかった送信は、やり直す前に履歴を見て、もう入っていれば送らない
async function alreadySaved(report) {
  await loadHistory(report.type, { force: true });
  const cached = readHistoryCache(report.type);
  return Boolean(cached && cached.savedAt > report.sentAt && DuplicateCheck.findInHistory(report, cached.items));
}
let processing = false;
async function processQueue() {
  if (processing) return; processing = true;
  try {
    for (;;) {
      const entry = readQueue().find((item) => item.state === 'sending' && !inFlight.has(item.id));
      if (!entry) break;
      inFlight.add(entry.id);
      try {
        if (entry.tries > 0 || entry.resumed) {
          if (entry.tries > 0) await new Promise((resolve) => window.setTimeout(resolve, Math.min(30000, 8000 * entry.tries)));
          if (await alreadySaved(entry.report)) { finishEntry(entry, null); continue; }
        }
        const outcome = await sendOnce(entry.report);
        if (outcome.ok) { finishEntry(entry, outcome.result); continue; }
        const tries = entry.tries + 1;
        if (outcome.definite || tries >= 4) { updateEntry(entry.id, { state: 'failed', error: outcome.error, tries, resumed: false }); markSent(entry.report, 'unknown'); }
        else updateEntry(entry.id, { tries, resumed: false });
      } finally { inFlight.delete(entry.id); renderQueue(); }
    }
  } finally { processing = false; renderQueue(); }
}
function finishEntry(entry, result) {
  removeEntry(entry.id); markSent(entry.report, 'sent');
  showToast(result && !result.ok && result.error ? result.error : '記録しました。');
  showJustSaved(entry.report); loadHistory(entry.report.type, { force: true }); notifyStockChanged(entry.report.type);
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-queue]'); if (!button) return;
  if (button.dataset.queue === 'retry') { writeQueue(readQueue().map((entry) => entry.state === 'failed' ? { ...entry, state: 'sending', tries: 0, resumed: true } : entry)); renderQueue(); processQueue(); }
  else if (window.confirm('送れなかった記録を取り消しますか？（シートには入りません）')) { writeQueue(readQueue().filter((entry) => entry.state !== 'failed')); renderQueue(); }
});
window.addEventListener('online', () => processQueue());

// 設定は前回の分ですぐ画面を出し、最新は裏で読む（変わっていて、まだ何も入力していなければ作り直す）
function startApp(config) { appConfig = config; document.title = `${config.title}・入荷・出荷`; document.querySelector('#page-title').textContent = `${config.title}・入荷・出荷`; document.querySelector('.multiplier').textContent = `1本 = 小瓶 ${formatNumber(config.smallBottleFactor)}本`; populateRecorderOptions(); createInputs(); Object.keys(dateInputs).forEach((type) => { dateInputs[type].value = today(); updateSummary(type); }); openFromUrl(); }
function formsTouched() { return Object.values(forms).some((form) => [...form.querySelectorAll('input[type="number"], textarea, select')].some((el) => el.value && el.value !== '0')); }
let cachedConfigText = null; try { cachedConfigText = window.localStorage.getItem('appConfig'); } catch { /* 無ければ読み込みを待つ */ }
if (cachedConfigText) { try { startApp(JSON.parse(cachedConfigText)); } catch { cachedConfigText = null; } }
function resumeQueue() { writeQueue(readQueue().map((entry) => entry.state === 'sending' ? { ...entry, resumed: true } : entry)); renderQueue(); processQueue(); }
if (appConfig) { loadHistory(currentMode); resumeQueue(); }
fetch('/api/config', { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error('設定を取得できませんでした。'); return response.json(); }).then((config) => { const text = JSON.stringify(config); try { window.localStorage.setItem('appConfig', text); } catch { /* 次回も読み込めば足りる */ } if (!appConfig) { startApp(config); loadHistory(currentMode); resumeQueue(); } else if (text !== cachedConfigText && !formsTouched()) { startApp(config); renderQueue(); } else { appConfig = config; } }).catch((error) => { if (!appConfig) setError(error.message || '設定を取得できませんでした。'); });

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && appConfig) loadHistory(currentMode); });
