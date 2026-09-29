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

  function chip(plan) {
    const pro = plan.label === 'PRO';
    return `<span class="plan-chip${pro ? ' is-pro' : ''}">${esc(plan.label)}<b>${num(plan.count)}</b></span>`;
  }

  // プランごとの 件数・1銘柄あたり・必要本数 の表
  function planTable(plans) {
    if (!plans.length) return '<p class="history-empty">この期間の出荷はありません。</p>';
    const rows = plans.map((p) => `<tr class="${p.label === 'PRO' ? 'is-pro' : ''}">
        <th scope="row">${esc(p.label)}</th>
        <td>${num(p.count)}<small>件</small></td>
        <td title="${num(p.count)} ÷ ${data.factor} = ${p.exact}">${num(p.perWine)}<small>本</small></td>
        <td class="strong">${num(p.bottles)}<small>本</small></td>
      </tr>`).join('');
    const total = plans.reduce((s, p) => ({ count: s.count + p.count, bottles: s.bottles + p.bottles }), { count: 0, bottles: 0 });
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
    $('sum-bottles').textContent = num(data.bottles);
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
        notes.push(`土日の配送分を前倒し：${day.shifted.map((s) => `${md(s.date)}(${s.weekday}) ${num(s.count)}件`).join('・')}`);
      }
      if (day.pro) {
        const span = day.pro.from === day.pro.to ? md(day.pro.from) : `${md(day.pro.from)}〜${md(day.pro.to)}`;
        notes.push(`PROの月末出荷：${span} の配送分 ${num(day.pro.count)}件`);
      }
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

  // ── 月ごとの合計と発注本数 ─────────────────────────
  function renderMonths() {
    $('ship-months').innerHTML = data.months.map((month) => {
      const wines = month.plans.map((p) => `
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
          <div><span>出荷件数</span><strong>${num(month.total)}<small>件</small></strong></div>
          <div><span>必要なワイン</span><strong>${num(month.bottles)}<small>本</small></strong></div>
        </div>
        ${planTable(month.plans)}
        <details class="wine-details">
          <summary>銘柄ごとの本数を見る（発注用）</summary>
          <div class="wine-groups">${wines}</div>
        </details>
        <button class="history-refresh copy-order" type="button" data-month="${esc(month.key)}">発注リストをコピー</button>
      </article>`;
    }).join('');
  }

  function orderText(month) {
    const lines = [
      `${monthLabel(month.key)} 発注本数（${data.factor}件でワイン1本として計算）`,
      `出荷件数 ${num(month.total)}件 ／ 必要なワイン ${num(month.bottles)}本`,
      '※予定の数です。最新の件数は長谷川さんからの依頼数を確認してください。',
      '',
    ];
    month.plans.forEach((p) => {
      lines.push(`■ ${p.label}（${num(p.count)}件・1銘柄 ${num(p.perWine)}本 × ${p.wineCount}銘柄 = ${num(p.bottles)}本）`);
      p.wines.forEach((w) => lines.push(`  ${w.id} ${w.name || '（銘柄未設定）'}：${num(w.bottles)}本`));
    });
    return lines.join('\n');
  }

  async function copyOrder(key) {
    const month = data.months.find((m) => m.key === key);
    if (!month) return;
    const text = orderText(month);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text; document.body.appendChild(area); area.select();
      document.execCommand('copy'); area.remove();
    }
    toast(`${monthLabel(key)}の発注リストをコピーしました`);
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

  // 開きっぱなしでも、日付が変わったら自動で「これからの1週間」を更新する
  setInterval(() => { if (data && todayKey() !== data.today) { openWeeks.clear(); load(); } }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data && todayKey() !== data.today) { openWeeks.clear(); load(); }
  });

  load();
})();
