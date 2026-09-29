(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n).toLocaleString('ja-JP');
  const md = (key) => { const [, m, d] = key.split('-'); return `${Number(m)}/${Number(d)}`; };

  // 日本時間の今日（YYYY-MM-DD）
  const todayKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

  let data = null;
  let view = 'list';

  function chip(plan) {
    const pro = plan.label === 'PRO';
    return `<span class="plan-chip${pro ? ' is-pro' : ''}">${esc(plan.label)}<b>${num(plan.count)}</b></span>`;
  }

  function renderSummary() {
    const pro = data.plans.find((p) => p.label === 'PRO');
    const peak = data.days.reduce((best, day) => (!best || day.total > best.total ? day : best), null);
    $('sum-total').textContent = num(data.total);
    $('sum-days').textContent = num(data.days.length);
    $('sum-pro').textContent = num(pro ? pro.count : 0);
    $('sum-peak').textContent = peak ? `${md(peak.date)}(${peak.weekday})` : '-';
    $('sum-peak-count').textContent = peak ? `${num(peak.total)}件` : '';
    $('ship-plans').innerHTML = data.plans.map(chip).join('');
    $('ship-summary').hidden = false;
    $('ship-plans-card').hidden = false;
    $('ship-view-tabs').hidden = false;
  }

  function renderList() {
    const today = todayKey();
    const peak = Math.max(...data.days.map((d) => d.total));
    $('ship-list').innerHTML = data.days.map((day) => {
      const notes = [];
      if (day.shifted.length) {
        notes.push(`土日の配送分を前倒し：${day.shifted.map((s) => `${md(s.date)}(${s.weekday}) ${num(s.count)}件`).join('・')}`);
      }
      if (day.pro) {
        const range = day.pro.from === day.pro.to ? md(day.pro.from) : `${md(day.pro.from)}〜${md(day.pro.to)}`;
        notes.push(`PROの月末出荷：${range} の配送分 ${num(day.pro.count)}件`);
      }
      const past = day.date < today;
      return `<article class="ship-day${past ? ' is-past' : ''}${day.total === peak ? ' is-peak' : ''}">
        <div class="ship-date">
          <span class="md">${md(day.date)}</span>
          <span class="wd">${esc(day.weekday)}</span>
          <span class="total">${num(day.total)}<small>件</small></span>
        </div>
        <div class="ship-body">
          <div class="plan-chips">${day.plans.map(chip).join('')}</div>
          ${notes.length ? `<ul class="ship-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          ${past ? '<span class="ship-past-label">この出荷日は過ぎています</span>' : ''}
        </div>
      </article>`;
    }).join('');
  }

  function renderTable() {
    const today = todayKey();
    const labels = data.plans.map((p) => p.label);
    const head = `<thead><tr><th>出荷日</th><th>合計</th>${labels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead>`;
    const body = data.days.map((day) => {
      const counts = Object.fromEntries(day.plans.map((p) => [p.label, p.count]));
      return `<tr class="${day.date < today ? 'is-past' : ''}"><td>${md(day.date)}(${esc(day.weekday)})</td><td class="total">${num(day.total)}</td>${labels.map((l) => (counts[l] ? `<td>${num(counts[l])}</td>` : '<td class="zero">0</td>')).join('')}</tr>`;
    }).join('');
    const foot = `<tfoot><tr><td>合計</td><td class="total">${num(data.total)}</td>${data.plans.map((p) => `<td>${num(p.count)}</td>`).join('')}</tr></tfoot>`;
    $('ship-table').innerHTML = head + `<tbody>${body}</tbody>` + foot;
  }

  function applyView() {
    document.querySelectorAll('.ship-view-tab').forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('ship-list').hidden = view !== 'list';
    $('ship-table-card').hidden = view !== 'table';
  }

  async function load() {
    const button = $('ship-reload');
    button.disabled = true;
    $('ship-error').hidden = true;
    $('ship-status').textContent = 'スプレッドシートを読み込み中です…';
    try {
      const response = await fetch('/api/shipments', { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '読み込めませんでした。');
      data = result;
      const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(result.fetchedAt));
      const skipped = result.skipped.length ? `（読めなかった行 ${num(result.skipped.length)}件は除外）` : '';
      $('ship-status').textContent = `${time} 時点・${num(result.total)}件${skipped}`;
      $('ship-source').href = result.source;
      $('ship-source').hidden = false;
      renderSummary();
      renderList();
      renderTable();
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
  $('ship-reload').addEventListener('click', load);
  load();
})();
