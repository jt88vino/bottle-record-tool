(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n).toLocaleString('ja-JP');
  const md = (key) => { const [, m, d] = key.split('-'); return `${Number(m)}/${Number(d)}`; };
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const wd = (key) => WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()];
  const monthLabel = (key) => { const [y, m] = key.split('-'); return `${y}年${Number(m)}月`; };

  // 日本時間の今日（YYYY-MM-DD）。勤怠アプリが表示している日付と同じ基準
  const todayKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

  let data = null;
  let view = 'week';
  const openWeeks = new Set(); // 開いたトグルは再読み込みしても開いたままにする
  let openLevels = null;         // 発注アラートの区分トグル（初回は既定の開閉）
  const openWineDetails = new Set(); // 月カードの「銘柄ごとの本数を見る」
  // 発注アラートからの入荷の記録
  const drafts = new Map();   // 入力途中の本数（自動の読み直しで消えないように）
  const recorded = new Map(); // 記録した入荷。在庫に反映されるまで「記録しました」と出す
  const sending = new Set();  // 送信中の銘柄（二重に送らない）
  const failed = new Map();   // 送れなかった銘柄とその理由
  let recorderRows = {};      // 在庫シートの番号（vol.8-4）→ 瓶詰め記録の銘柄の id

  function chip(plan) {
    const pro = plan.label === 'PRO';
    return `<span class="plan-chip${pro ? ' is-pro' : ''}">${esc(plan.label)}<b>${num(plan.count)}</b></span>`;
  }

  // プランごとの 件数・1銘柄あたり・必要本数 の表
  function planTable(plans) {
    if (!plans.length) return '<p class="history-empty">この期間の出荷はありません。</p>';
    const rows = plans.map((p) => `<tr class="${p.label === 'PRO' ? 'is-pro' : ''}${p.forecast ? ' is-forecast' : ''}">
        <th scope="row">${esc(p.label)}</th>
        <td>${num(p.count)}<small>件</small></td>
        <td title="${num(p.count)} ÷ ${data.factor} = ${p.exact}">${num(p.perWine)}<small>本</small></td>
        <td class="strong">${num(p.bottles)}<small>本</small></td>
      </tr>`).join('');
    // 件数の合計は定期便の予定だけ（Vol.1 の見込み件数は足さない）。本数は見込み分も含める
    const total = plans.reduce((s, p) => ({ count: s.count + (p.forecast ? 0 : p.count), bottles: s.bottles + p.bottles }), { count: 0, bottles: 0 });
    return `<div class="plan-table-scroll"><table class="plan-table">
      <thead><tr><th scope="col">プラン</th><th scope="col">件数</th><th scope="col">1銘柄あたり</th><th scope="col">必要本数</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th scope="row">合計</th><td>${num(total.count)}<small>件</small></td><td></td><td class="strong">${num(total.bottles)}<small>本</small></td></tr></tfoot>
    </table></div>`;
  }

  function range(start, end) {
    return `${md(start)}(${wd(start)})〜${md(end)}(${wd(end)})`;
  }

  function weekTitle(index) {
    if (index === 0) return 'これからの1週間';
    if (index === 1) return 'その次の1週間';
    return `${index}週間後`;
  }

  function renderSummary() {
    const first = data.weeks[0];
    $('sum-week').textContent = num(first ? first.total : 0);
    $('sum-week-sub').textContent = first ? range(first.start, first.end) : '予定はありません';
    $('sum-week-bottles').textContent = num(first ? first.bottles : 0);
    $('sum-total').textContent = num(data.total);
    const forecastBottles = (data.forecasts || []).reduce((sum, p) => sum + p.bottles, 0);
    $('sum-bottles').textContent = num(data.bottles + forecastBottles);
    $('sum-bottles-sub').textContent = forecastBottles
      ? `${(data.forecasts || []).map((p) => `${p.label}見込み ${num(p.bottles)}本`).join('・')}を含む` : '';
    document.querySelectorAll('.rule-factor').forEach((el) => { el.textContent = String(data.factor); });
    $('ship-summary').hidden = false;
    $('ship-view-tabs').hidden = false;
  }

  // ── 週ごと：最初の1週間だけ開き、その先はトグル ─────────
  function weekBody(week) {
    const days = week.days.length
      ? `<div class="week-days">${week.days.map((d) => `<span class="week-day">${md(d.date)}(${esc(d.weekday)}) <b>${num(d.total)}</b>件</span>`).join('')}</div>`
      : '';
    return `${days}${planTable(week.plans)}`;
  }

  function weekTotals(week) {
    return `<span class="week-totals"><span><b>${num(week.total)}</b>件</span><span class="bottles"><b>${num(week.bottles)}</b>本</span></span>`;
  }

  function renderWeeks() {
    if (!data.weeks.length) {
      $('ship-weeks').innerHTML = '<p class="history-empty">これからの出荷予定はありません。新しいレポートをスプレッドシートに貼ってください。</p>';
    } else {
      const [first, ...rest] = data.weeks;
      const firstCard = `<article class="card week-card is-current">
        <div class="week-head">
          <div><p class="week-label">${weekTitle(0)}</p><h3>${range(first.start, first.end)}</h3></div>
          ${weekTotals(first)}
        </div>
        ${weekBody(first)}
      </article>`;
      const toggles = rest.map((week) => {
        const key = week.start;
        return `<details class="card week-toggle" data-key="${esc(key)}"${openWeeks.has(key) ? ' open' : ''}>
          <summary>
            <span class="week-summary-text"><span class="week-label">${weekTitle(week.index)}</span><span class="week-range">${range(week.start, week.end)}</span></span>
            ${weekTotals(week)}
          </summary>
          <div class="week-toggle-body">${weekBody(week)}</div>
        </details>`;
      }).join('');
      $('ship-weeks').innerHTML = firstCard + toggles;
    }
    if (data.past) {
      $('ship-weeks').insertAdjacentHTML('beforeend', `<details class="card week-toggle is-past" data-key="past"${openWeeks.has('past') ? ' open' : ''}>
        <summary>
          <span class="week-summary-text"><span class="week-label">過ぎた出荷日</span><span class="week-range">${range(data.past.from, data.past.to)}</span></span>
          ${weekTotals(data.past)}
        </summary>
        <div class="week-toggle-body">${weekBody(data.past)}</div>
      </details>`);
    }
  }

  // ── 日付ごと ─────────────────────────────────
  function renderDays() {
    const today = data.today;
    const upcoming = data.days.filter((d) => d.date >= today);
    const peak = Math.max(0, ...upcoming.map((d) => d.total));
    $('ship-list').innerHTML = upcoming.length ? upcoming.map((day) => {
      const notes = [];
      if (day.shifted.length) {
        notes.push(`お客様に届く日：${day.shifted.map((s) => `${md(s.date)}(${s.weekday}) ${num(s.count)}件`).join('・')}`);
      }
      if (day.pro) {
        const span = day.pro.from === day.pro.to ? md(day.pro.from) : `${md(day.pro.from)}〜${md(day.pro.to)}`;
        notes.push(`PROの月末出荷：${span} の配送分 ${num(day.pro.count)}件`);
      }
      const byDelivery = (list) => list.map((s) => `${md(s.date)}(${s.weekday})着 ${num(s.count)}件`).join('・');
      if (day.extra && day.extra.length) notes.push(`定期レポートに無く、連絡をもらった数：${byDelivery(day.extra)}`);
      if (day.fromLedger && day.fromLedger.length) notes.push(`注文が出て定期レポートから消えた分（前に読んだ数）：${byDelivery(day.fromLedger)}`);
      if (day.estimated && day.estimated.length) notes.push(`どこにも数が無いため見積もった分：${byDelivery(day.estimated)}`);
      return `<article class="ship-day${day.total === peak ? ' is-peak' : ''}">
        <div class="ship-date">
          <span class="md">${md(day.date)}</span>
          <span class="wd">${esc(day.weekday)}</span>
          <span class="total">${num(day.total)}<small>件</small></span>
        </div>
        <div class="ship-body">
          <div class="plan-chips">${day.plans.map(chip).join('')}</div>
          ${notes.length ? `<ul class="ship-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        </div>
      </article>`;
    }).join('') : '<p class="history-empty">これからの出荷予定はありません。</p>';
  }

  // ── 発注アラート ─────────────────────────────
  const openMore = new Set(); // 「くわしく」を開いた銘柄（自動の読み直しでも開いたまま）

  const LEVELS = {
    urgent: { label: '至急', title: '発注期限が明日まで', open: true },
    soon: { label: '今週中', title: '今週中に発注', open: true },
    later: { label: 'その後', title: '今後必要', open: true },
    low: { label: '残り少ない', title: '在庫が少ない（出荷分はある）', open: true },
    ok: { label: '問題なし', title: '発注不要', open: false },
  };

  function wineRow(item) {
    const name = item.name || '（銘柄未設定）';
    const s = data.stock;
    const factor = s.factor || data.factor;
    const day = (key, weekday) => `${md(key)}(${esc(weekday || wd(key))})`;
    // 結論だけを1行に：ワインボトル（750ml）を何本発注するか。サブスクの件数は前後するので、出荷に必要な最小限の本数。
    // 至急は「いま発注しないと間に合わない出荷分」だけ。月の分は至急に入れず、その発注期限までに発注すればよい
    const needs = [];
    if (item.urgentNeed) needs.push(`<span class="need is-urgent">至急 <b>${num(item.urgentNeed)}本</b></span>`);
    (item.monthNeeds || []).forEach((m) => needs.push(`<span class="need is-month">${Number(m.month.slice(5))}月 <b>${num(m.bottles)}本</b><small>期限 ${day(m.orderBy, m.orderByWeekday)}</small></span>`));
    if (!needs.length) needs.push(item.level === 'low' ? `<span class="need is-low">在庫 <b>${num(item.stock)}本</b></span>` : '<span class="need is-ok">発注不要</span>');
    (item.warnings || []).forEach((w) => needs.push(`<span class="need is-warn">⚠ ${esc(w)}</span>`));
    // くわしく：足りなくなる日と期限、本数の根拠、小瓶にそろえた内訳
    const when = item.runsOutOn
      ? `${day(item.runsOutOn, item.runsOutWeekday)}${item.forecast ? 'ごろ' : ''}に足りなくなる${item.arriveBy && item.arriveBy !== item.runsOutOn ? `・到着期限 ${day(item.arriveBy, item.arriveByWeekday)}` : ''}・発注期限 ${day(item.orderBy, item.orderByWeekday)}`
      : (item.shipments ? '今後の出荷分は足りています' : '今後の出荷予定はありません');
    const why = [];
    if (item.urgentNeed) why.push(`至急：${day(item.urgentUntil, item.urgentUntilWeekday)}の出荷${item.urgentDeliveryUntil ? `（${md(item.urgentDeliveryUntil)}着）` : ''}分まで`);
    (item.monthNeeds || []).forEach((m) => why.push(`${Number(m.month.slice(5))}月：${day(m.from, m.fromWeekday)}の出荷分から`));
    // 内訳：出荷1件で小瓶1本を使うので、小瓶の本数にそろえて比べる
    const period = item.forecast ? '今後1か月の出荷（見込み）' : `${md(s.horizonEnd)}(${wd(s.horizonEnd)})までの出荷`;
    const stockSmall = Math.max(item.stock, 0) * factor;
    const shortSmall = Math.max(0, Math.ceil(item.shipments - item.smallBottles - stockSmall - 1e-9));
    const math = item.shipments ? `<dl class="stock-math">
        <div><dt>${period}</dt><dd>${num(item.shipments)}件 → 小瓶 <b>${num(item.shipments)}本</b></dd></div>
        <div><dt>瓶詰め済みの小瓶</dt><dd><b>${num(item.smallBottles)}本</b>${item.plan === 'PRO' ? '（PRO は数えていません）' : ''}</dd></div>
        <div><dt>ワインボトルの在庫</dt><dd><b>${num(item.stock)}本</b>（小瓶 ${num(stockSmall)}本分）</dd></div>
        <div class="${shortSmall ? 'is-short' : 'is-enough'}"><dt>${shortSmall ? '足りない分' : '差し引き'}</dt><dd>${shortSmall
          ? `小瓶 <b>${num(shortSmall)}本</b> ＝ ボトル <b>${num(item.shortage)}本</b>`
          : `小瓶 ${num(Math.floor(item.smallBottles + stockSmall - item.shipments))}本あまる`}</dd></div>
      </dl>` : `<p class="stock-math-none">ワインボトルの在庫 ${num(item.stock)}本</p>`;
    const open = openMore.has(item.id);
    const more = `<div class="stock-more"${open ? '' : ' hidden'}>
        <p class="stock-when">${when}</p>
        ${why.map((t) => `<p class="stock-why">${t}</p>`).join('')}
        ${math}
        ${item.notes.length ? `<ul class="stock-notes">${item.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>`;
    // 入荷の記録（入荷タブと同じく Slack と在庫管理シートへ）
    const done = recorded.get(item.id);
    if (done && (item.stock >= done.stockBefore + done.bottles || Date.now() - done.at > 15 * 60 * 1000)) recorded.delete(item.id);
    const stillDone = recorded.get(item.id);
    const busy = sending.has(item.id);
    const error = failed.get(item.id);
    const record = item.level === 'ok' ? '' : `<form class="incoming-inline" data-wine="${esc(item.id)}">
        <label><span>入荷</span><input type="number" name="bottles" min="1" max="9999" step="1" inputmode="numeric" placeholder="本数" value="${esc(drafts.get(item.id) || '')}" aria-label="${esc(item.id)} の入荷本数"${busy ? ' disabled' : ''} /><span>本</span></label>
        <button class="incoming-submit" type="submit"${busy ? ' disabled' : ''}>${busy ? '記録中…' : '記録'}</button>
        ${stillDone ? `<p class="incoming-done">入荷 ${num(stillDone.bottles)}本を記録しました（反映まで数分）</p>` : ''}
        ${error ? `<p class="incoming-error">${esc(error)}</p>` : ''}
      </form>`;
    return `<li class="stock-item level-${item.level}">
      <div class="stock-name"><span class="stock-id">${esc(item.id)}</span><span>${esc(name)}</span></div>
      <div class="stock-needs">${needs.join('')}</div>
      <div class="stock-actions">${record}<button class="more-toggle" type="button" data-wine="${esc(item.id)}" aria-expanded="${open}">くわしく</button></div>
      ${more}
    </li>`;
  }

  function renderStock() {
    const card = $('stock-card');
    $('stock-error').hidden = true;
    if (!data.stock) {
      card.hidden = true;
      $('alert-badge').hidden = true;
      if (data.stockError) { $('stock-error').textContent = data.stockError; $('stock-error').hidden = false; }
      return;
    }
    const s = data.stock;
    const loadedAt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(data.fetchedAt));
    $('stock-meta').innerHTML = `在庫 ${loadedAt} 時点・${s.horizonEnd ? `${md(s.horizonEnd)}(${wd(s.horizonEnd)})` : '-'}までの出荷で判定・本数はワインボトル（750ml）・<a href="${esc(s.source)}" target="_blank" rel="noopener">在庫のシート</a>`
      + (s.smallBottlesUnavailable ? '<br><b>出荷の記録を読めず、今回は瓶詰め済みの小瓶を数えていません</b>' : '');
    const badge = $('alert-badge');
    badge.textContent = s.counts.urgent ? `至急${s.counts.urgent}` : s.counts.soon ? `今週${s.counts.soon}` : '';
    badge.classList.toggle('is-urgent', !!s.counts.urgent);
    badge.hidden = !(s.counts.urgent || s.counts.soon);
    $('stock-counts').innerHTML = Object.keys(LEVELS).filter((k) => k !== 'ok')
      .map((k) => `<span class="stock-count level-${k}${s.counts[k] ? '' : ' is-zero'}">${LEVELS[k].label}<b>${num(s.counts[k])}</b></span>`).join('');
    if (!openLevels) openLevels = new Set(Object.keys(LEVELS).filter((k) => LEVELS[k].open));
    // 入力中の欄があれば、描き直したあとも同じ欄にカーソルを戻す
    const active = document.activeElement;
    const focusedWine = active && active.closest && active.closest('.incoming-inline') ? active.closest('.incoming-inline').dataset.wine : null;
    $('stock-groups').innerHTML = Object.keys(LEVELS).map((level) => {
      const items = s.items.filter((i) => i.level === level);
      if (!items.length) return '';
      const meta = LEVELS[level];
      return `<details class="stock-group level-${level}" data-level="${level}"${openLevels.has(level) ? ' open' : ''}>
        <summary><span class="stock-badge level-${level}">${meta.label}</span>${esc(meta.title)}<b>${num(items.length)}銘柄</b></summary>
        <ul class="stock-list">${items.map(wineRow).join('')}</ul>
      </details>`;
    }).join('');
    $('stock-copy').hidden = !s.items.some((i) => i.urgentNeed || (i.monthNeeds || []).some((m) => m.orderBy <= addDaysKey(s.today, 6)));
    card.hidden = false;
    if (focusedWine) {
      const input = document.querySelector(`.incoming-inline[data-wine="${CSS.escape(focusedWine)}"] input`);
      if (input) input.focus({ preventScroll: true });
    }
  }

  // ── 発注アラートから入荷を記録する ─────────────────────
  // 本数を入れて「記録」を押すだけ。記入日は今日、記入者・備考は空欄（入荷タブと同じく Slack と在庫管理シートへ）
  async function loadWineIds() {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const config = await response.json();
      recorderRows = Object.fromEntries((config.groups || []).flatMap((g) => g.rows || []).map((row) => [row.label, row.id]));
    } catch {
      // 読めなければ、記録のときにもう一度読む
    }
  }

  async function recordIncoming(form) {
    const wine = form.dataset.wine;
    if (sending.has(wine)) return;
    const bottles = Number(form.elements.bottles.value);
    if (!Number.isInteger(bottles) || bottles < 1 || bottles > 9999) { toast('入荷した本数を入れてください'); form.elements.bottles.focus(); return; }
    if (!recorderRows[wine]) await loadWineIds();
    const rowId = recorderRows[wine];
    const item = data.stock.items.find((i) => i.id === wine);
    failed.delete(wine);
    if (!rowId) { failed.set(wine, 'この銘柄は瓶詰め記録の設定に見つかりません。入荷タブから記録してください'); renderStock(); return; }
    sending.add(wine);
    renderStock();
    const date = todayKey();
    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'incoming', date, recorderName: '', notes: '', supplier: '', items: [{ id: rowId, bottles, itemNote: '' }] }),
      });
      const result = await response.json().catch(() => ({}));
      if (!result.sheetsSaved) throw new Error(result.error || '記録できませんでした。もう一度押してください');
      drafts.delete(wine);
      recorded.set(wine, { bottles, date, stockBefore: item ? item.stock : 0, at: Date.now() });
      toast(`${wine} の入荷 ${num(bottles)}本 を記録しました`);
      // ほかのタブの出荷ページにも知らせ、在庫シートへの反映を待って読み直す
      try { window.localStorage.setItem('stockChangedAt', `${Date.now()}:incoming`); } catch { /* 知らせられなくても読み直しは下で行う */ }
      [20, 60, 180].forEach((sec) => setTimeout(reload, sec * 1000));
    } catch (error) {
      failed.set(wine, error.message || '記録できませんでした。もう一度押してください');
    } finally {
      sending.delete(wine);
      renderStock();
    }
  }

  function addDaysKey(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
  }

  function stockOrderText() {
    const s = data.stock;
    const lines = [`発注リスト（${md(s.today)}時点・届くまで${s.leadDays}日で計算・出荷に必要な最小限の本数）`, '※予定の数です。最新の件数は長谷川さんからの依頼数を確認してください。', ''];
    const urgent = s.items.filter((i) => i.urgentNeed);
    if (urgent.length) {
      lines.push('■ 至急（いま発注しないと間に合わない分だけ）');
      urgent.forEach((i) => lines.push(`  ${i.id} ${i.name || '（銘柄未設定）'}：ワインボトル ${i.urgentNeed}本（${md(i.urgentUntil)}の出荷${i.urgentDeliveryUntil ? `・${md(i.urgentDeliveryUntil)}着` : ''}分まで）`));
      lines.push('');
    }
    const soonLimit = addDaysKey(s.today, 6);
    const monthly = s.items.flatMap((i) => (i.monthNeeds || []).filter((m) => m.orderBy <= soonLimit).map((m) => ({ ...m, item: i })));
    if (monthly.length) {
      lines.push('■ 今週中に発注（至急とは別。月ごとに必要な分）');
      monthly.forEach((m) => lines.push(`  ${m.item.id} ${m.item.name || '（銘柄未設定）'}：ワインボトル ${m.bottles}本（${monthLabel(m.month).replace(/^\d+年/, '')}分・${md(m.from)}の出荷分から・発注期限${md(m.orderBy)}）`));
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text; document.body.appendChild(area); area.select();
      document.execCommand('copy'); area.remove();
    }
    toast(message);
  }

  // ── 月ごとの合計と発注本数 ─────────────────────────
  function renderMonths() {
    $('ship-months').innerHTML = data.months.map((month) => {
      const forecasts = month.forecasts || [];
      const plans = [...forecasts.map((p) => ({ ...p, label: `${p.label}（見込み）` })), ...month.plans];
      const forecastBottles = forecasts.reduce((sum, p) => sum + p.bottles, 0);
      const wines = plans.map((p) => `
        <div class="wine-group">
          <h4>${esc(p.label)}<span>${num(p.count)}件 ・ 1銘柄 ${num(p.perWine)}本</span></h4>
          <ul>${p.wines.map((w) => `<li><span class="wine-id">${esc(w.id)}</span><span class="wine-name">${esc(w.name || '（銘柄未設定）')}</span><b>${num(w.bottles)}本</b></li>`).join('')}</ul>
        </div>`).join('');
      return `<article class="card month-card">
        <div class="month-head">
          <h2>${esc(monthLabel(month.key))}の合計</h2>
          <p class="month-range">出荷日 ${range(month.from, month.to)}・${num(month.days.length)}日</p>
        </div>
        <div class="month-kpis">
          <div><span>出荷件数（定期便）</span><strong>${num(month.total)}<small>件</small></strong></div>
          <div><span>必要なワイン</span><strong>${num(month.bottles + forecastBottles)}<small>本</small></strong>${forecastBottles ? `<em>Vol.1見込み ${num(forecastBottles)}本を含む</em>` : ''}</div>
        </div>
        ${planTable(plans)}
        <details class="wine-details" data-month="${esc(month.key)}"${openWineDetails.has(month.key) ? ' open' : ''}>
          <summary>銘柄ごとの本数を見る（発注用）</summary>
          <div class="wine-groups">${wines}</div>
        </details>
        <button class="history-refresh copy-order" type="button" data-month="${esc(month.key)}">発注リストをコピー</button>
      </article>`;
    }).join('');
  }

  function orderText(month) {
    const forecasts = month.forecasts || [];
    const lines = [
      `${monthLabel(month.key)} 発注本数（${data.factor}件でワイン1本として計算）`,
      `出荷件数 ${num(month.total)}件 ／ 必要なワイン ${num(month.bottles + forecasts.reduce((sum, p) => sum + p.bottles, 0))}本${forecasts.length ? `（${forecasts.map((p) => `${p.label}は${num(p.count)}件の見込み`).join('・')}）` : ''}`,
      '※予定の数です。最新の件数は長谷川さんからの依頼数を確認してください。',
      '',
    ];
    [...forecasts.map((p) => ({ ...p, label: `${p.label}（見込み）` })), ...month.plans].forEach((p) => {
      lines.push(`■ ${p.label}（${num(p.count)}件・1銘柄 ${num(p.perWine)}本 × ${p.wineCount}銘柄 = ${num(p.bottles)}本）`);
      p.wines.forEach((w) => lines.push(`  ${w.id} ${w.name || '（銘柄未設定）'}：${num(w.bottles)}本`));
    });
    return lines.join('\n');
  }

  async function copyOrder(key) {
    const month = data.months.find((m) => m.key === key);
    if (!month) return;
    await copyText(orderText(month), `${monthLabel(key)}の発注リストをコピーしました`);
  }

  function toast(message) {
    const el = $('ship-toast');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('visible'), 2400);
  }

  function applyView() {
    document.querySelectorAll('.ship-view-tab').forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('ship-weeks').hidden = view !== 'week';
    $('ship-list').hidden = view !== 'day';
  }

  async function load() {
    const button = $('ship-reload');
    button.disabled = true;
    $('ship-error').hidden = true;
    $('ship-status').textContent = 'スプレッドシートを読み込み中です…';
    try {
      const response = await fetch(`/api/shipments?today=${todayKey()}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '読み込めませんでした。');
      data = result;
      const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(result.fetchedAt));
      const skipped = result.skipped.length ? `（読めなかった行 ${num(result.skipped.length)}件は除外）` : '';
      $('ship-status').textContent = `${time} 時点・今日 ${md(result.today)}(${wd(result.today)}) 基準${skipped}`;
      $('ship-source').href = result.source;
      $('ship-source').hidden = false;
      renderSummary();
      renderStock();
      renderWeeks();
      renderDays();
      renderMonths();
      applyView();
    } catch (error) {
      $('ship-status').textContent = '';
      $('ship-error').textContent = error.message;
      $('ship-error').hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  // 出荷件数 / 発注アラート の切り替え。最後に見た方を覚えておく（#alert・#count でも開ける）
  const PAGE_KEY = 'shipments.page';
  let page = 'count';
  try { page = window.localStorage.getItem(PAGE_KEY) === 'alert' ? 'alert' : 'count'; } catch { /* 覚えていなければ出荷件数 */ }
  if (window.location.hash === '#alert' || window.location.hash === '#count') page = window.location.hash.slice(1);
  function applyPage() {
    document.querySelectorAll('.page-tab').forEach((tab) => {
      const active = tab.dataset.page === page;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('page-count').hidden = page !== 'count';
    $('page-alert').hidden = page !== 'alert';
  }
  document.querySelectorAll('.page-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      page = tab.dataset.page;
      applyPage();
      try { window.localStorage.setItem(PAGE_KEY, page); } catch { /* 覚えられなくても切り替えはできる */ }
      window.history.replaceState(null, '', `#${page}`);
    });
  });
  applyPage();

  document.querySelectorAll('.ship-view-tab').forEach((tab) => {
    tab.addEventListener('click', () => { view = tab.dataset.view; applyView(); });
  });
  $('ship-weeks').addEventListener('toggle', (event) => {
    const el = event.target;
    if (!el.matches || !el.matches('details.week-toggle')) return;
    if (el.open) openWeeks.add(el.dataset.key); else openWeeks.delete(el.dataset.key);
  }, true);
  $('ship-months').addEventListener('click', (event) => {
    const button = event.target.closest('.copy-order');
    if (button) copyOrder(button.dataset.month);
  });
  $('ship-reload').addEventListener('click', load);
  $('stock-groups').addEventListener('input', (event) => {
    const form = event.target.closest('.incoming-inline');
    if (form) drafts.set(form.dataset.wine, event.target.value);
  });
  $('stock-groups').addEventListener('submit', (event) => {
    const form = event.target.closest('.incoming-inline');
    if (!form) return;
    event.preventDefault();
    recordIncoming(form);
  });
  $('stock-copy').addEventListener('click', () => copyText(stockOrderText(), '発注リストをコピーしました'));

  $('stock-groups').addEventListener('click', (event) => {
    const button = event.target.closest('.more-toggle');
    if (!button) return;
    const more = button.closest('.stock-item').querySelector('.stock-more');
    const open = more.hidden;
    more.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) openMore.add(button.dataset.wine); else openMore.delete(button.dataset.wine);
  });
  $('stock-card').addEventListener('toggle', (event) => {
    const group = event.target.closest && event.target.closest('details.stock-group');
    if (group && event.target === group && openLevels) {
      if (group.open) openLevels.add(group.dataset.level); else openLevels.delete(group.dataset.level);
    }
  }, true);
  $('ship-months').addEventListener('toggle', (event) => {
    const el = event.target;
    if (!el.matches || !el.matches('details.wine-details')) return;
    if (el.open) openWineDetails.add(el.dataset.month); else openWineDetails.delete(el.dataset.month);
  }, true);

  // 入荷などを記録すると、瓶詰め記録の画面が stockChangedAt を書き換える → 在庫を読み直す
  let loading = false;
  let lastLoaded = 0;
  async function reload() {
    if (loading) return;
    loading = true;
    try { await load(); lastLoaded = Date.now(); } finally { loading = false; }
  }
  window.addEventListener('storage', (event) => {
    if (event.key === 'stockChangedAt') {
      reload();
      // 在庫シートへの反映に少し時間がかかるので、1分後と3分後にもう一度読む
      setTimeout(reload, 60 * 1000);
      setTimeout(reload, 3 * 60 * 1000);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const dayChanged = data && todayKey() !== data.today;
    if (dayChanged) openWeeks.clear();
    if (dayChanged || Date.now() - lastLoaded > 60 * 1000) reload();
  });
  // 別の端末で入荷を記録した場合も早めに気づけるよう、表示中は2分ごとに読み直す（Google の CSV を読むだけなので軽い）
  setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 2 * 60 * 1000);

  // 開きっぱなしでも、日付が変わったら自動で「これからの1週間」を更新する
  setInterval(() => { if (data && todayKey() !== data.today) { openWeeks.clear(); reload(); } }, 60 * 1000);

  loadWineIds();
  reload();
})();
