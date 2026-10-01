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
  let recorderRows = {};      // 在庫シートの番号（vol.8-4）→ 瓶詰め記録の銘柄（id・ワイン名）
  let pendingIncoming = null;

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
  const OPEN_KEY = 'shipments.stockOpen';
  function readOpen() { try { return window.localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } }
  function saveOpen(open) { try { window.localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* 保存できなくても表示には影響しない */ } }

  const LEVELS = {
    urgent: { label: '至急', title: '至急：発注期限が明日まで', open: true },
    soon: { label: '今週中', title: '今週中に発注', open: true },
    later: { label: 'その後', title: '今後、発注が必要', open: true },
    low: { label: '残り少ない', title: `在庫が少ない（出荷分は足りている）`, open: true },
    ok: { label: '問題なし', title: '問題なし', open: false },
  };

  function wineRow(item) {
    const name = item.name || '（銘柄未設定）';
    const lines = [];
    if (item.runsOutOn) {
      const arrive = item.arriveBy && item.arriveBy !== item.runsOutOn
        ? `<span>到着期限 ${md(item.arriveBy)}(${esc(item.arriveByWeekday)})</span>` : '';
      lines.push(`<span>${md(item.runsOutOn)}(${esc(item.runsOutWeekday)})${item.forecast ? 'ごろ' : ''}に足りなくなる</span>${arrive}<span class="deadline">発注期限 ${md(item.orderBy)}(${esc(item.orderByWeekday)})</span>`);
    } else if (!item.shipments) {
      lines.push('<span>今後の出荷予定はありません</span>');
    } else {
      lines.push('<span>今後の出荷分は足りています</span>');
    }
    // 結論：ワインボトル（750ml）を何本発注するか。サブスクの件数は前後するので、出荷に必要な最小限の本数にする。
    // 至急は「いま発注しないと間に合わない出荷分」だけ。月の分は至急に入れず、その発注期限までに発注すればよい
    const s = data.stock;
    const factor = s.factor || data.factor;
    const orders = [];
    if (item.urgentNeed) {
      const until = `${md(item.urgentUntil)}(${esc(item.urgentUntilWeekday)})の出荷${item.urgentDeliveryUntil ? `（${md(item.urgentDeliveryUntil)}着）` : ''}分まで`;
      orders.push(`<p class="stock-verdict is-order"><span class="verdict-tag">至急</span>ワインボトル（750ml） <b>${num(item.urgentNeed)}本</b><small>${until}に必ず必要な本数だけです。今日〜明日に発注してください</small></p>`);
    }
    (item.monthNeeds || []).forEach((m) => {
      orders.push(`<p class="stock-verdict is-month"><span class="verdict-tag">${esc(monthLabel(m.month).replace(/^\d+年/, ''))}に必要</span>ワインボトル（750ml） <b>${num(m.bottles)}本</b><small>${item.urgentNeed ? '至急とは別に、' : ''}${md(m.from)}(${esc(m.fromWeekday)})の出荷分から必要・発注期限 ${md(m.orderBy)}(${esc(m.orderByWeekday)})</small></p>`);
    });
    let verdict = orders.join('');
    if (!orders.length) {
      verdict = item.level === 'low'
        ? `<p class="stock-verdict is-low">出荷分は足りています（在庫が ${num(item.stock)}本 と少なくなっています）</p>`
        : '<p class="stock-verdict is-ok">発注は不要です</p>';
    }
    // 内訳：出荷1件で小瓶1本を使うので、小瓶の本数にそろえて比べる
    const period = item.forecast ? '今後1か月の出荷（見込み）' : `${md(s.horizonEnd)}(${wd(s.horizonEnd)})までの出荷`;
    const stockSmall = Math.max(item.stock, 0) * factor;
    const shortSmall = Math.max(0, Math.ceil(item.shipments - item.smallBottles - stockSmall - 1e-9));
    const math = item.shipments ? `<dl class="stock-math">
        <div><dt>${period}</dt><dd>${num(item.shipments)}件 → 小瓶 <b>${num(item.shipments)}本</b> が必要</dd></div>
        <div><dt>瓶詰め済みの小瓶</dt><dd><b>${num(item.smallBottles)}本</b>${item.plan === 'PRO' ? '（PRO は数えていません）' : ''}</dd></div>
        <div><dt>ワインボトルの在庫</dt><dd><b>${num(item.stock)}本</b>（小瓶 ${num(stockSmall)}本分）</dd></div>
        <div class="${shortSmall ? 'is-short' : 'is-enough'}"><dt>${shortSmall ? '足りない分' : '差し引き'}</dt><dd>${shortSmall
          ? `小瓶 <b>${num(shortSmall)}本</b>分 ＝ ワインボトル <b>${num(item.shortage)}本</b>（小瓶${num(factor)}本でボトル1本）`
          : `小瓶 ${num(Math.floor(item.smallBottles + stockSmall - item.shipments))}本分あまる`}</dd></div>
      </dl>` : `<p class="stock-math-none">今後の出荷予定はありません・ワインボトルの在庫 ${num(item.stock)}本</p>`;
    // 入荷の記録（入荷タブと同じく Slack と在庫管理シートへ）
    const done = recorded.get(item.id);
    if (done && (item.stock >= done.stockBefore + done.bottles || Date.now() - done.at > 15 * 60 * 1000)) recorded.delete(item.id);
    const stillDone = recorded.get(item.id);
    const record = item.level === 'ok' ? '' : `<form class="incoming-inline" data-wine="${esc(item.id)}">
        <label><span>入荷した本数</span><input type="number" name="bottles" min="1" max="9999" step="1" inputmode="numeric" placeholder="本数" value="${esc(drafts.get(item.id) || '')}" aria-label="${esc(item.id)} の入荷本数" /><span>本</span></label>
        <button class="incoming-submit" type="submit">入荷を記録</button>
        <a class="incoming-detail" href="/?tab=incoming&amp;wine=${encodeURIComponent(item.id)}">備考も入れる →</a>
        ${stillDone ? `<p class="incoming-done">${md(stillDone.date)} の入荷 ${num(stillDone.bottles)}本 を記録しました。在庫への反映に数分かかります</p>` : ''}
      </form>`;
    return `<li class="stock-item level-${item.level}">
      <div class="stock-name"><span class="stock-id">${esc(item.id)}</span><span>${esc(name)}</span></div>
      <div class="stock-when">${lines.join('')}</div>
      ${verdict}
      ${math}
      ${item.notes.length ? `<ul class="stock-notes">${item.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${record}
    </li>`;
  }

  function renderStock() {
    const card = $('stock-card');
    $('stock-error').hidden = true;
    if (!data.stock) {
      card.hidden = true;
      if (data.stockError) { $('stock-error').textContent = data.stockError; $('stock-error').hidden = false; }
      return;
    }
    const s = data.stock;
    card.open = readOpen();
    const loadedAt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(data.fetchedAt));
    $('stock-meta').innerHTML = `在庫は ${loadedAt} に読み込み（入荷を記録すると自動で読み直します）・`
      + `今日 ${md(s.today)}(${wd(s.today)}) から ${s.horizonEnd ? `${md(s.horizonEnd)}(${wd(s.horizonEnd)})` : '-'} の出荷分で判定・出荷日の${s.arriveDaysBefore}日前（PROは${s.proArriveDaysBefore}日前）までに到着・${s.smallBottlesSince ? `${md(s.smallBottlesSince)}以降に瓶詰めした小瓶も出荷に回して判定` : ''}${s.smallBottlesUnavailable ? '<b>出荷の記録を読めなかったため、今回は瓶詰め済みの小瓶を数えていません</b>' : ''}・発注から届くまで${s.leadDays}日・在庫${s.lowStock}本以下はお知らせだけ（発注の本数には足さない）・<a href="${esc(s.source)}" target="_blank" rel="noopener">在庫のシート</a>`;
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
    if (!$('incoming-date').value) $('incoming-date').value = todayKey();
    card.hidden = false;
    if (focusedWine) {
      const input = document.querySelector(`.incoming-inline[data-wine="${CSS.escape(focusedWine)}"] input`);
      if (input) input.focus({ preventScroll: true });
    }
  }

  // ── 発注アラートから入荷を記録する ─────────────────────
  async function loadRecorders() {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const config = await response.json();
      recorderRows = Object.fromEntries((config.groups || []).flatMap((g) => g.rows || []).map((row) => [row.label, { id: row.id, wineName: row.wineName || '' }]));
      const select = $('incoming-recorder');
      (config.recorderNames || []).forEach((name) => select.add(new Option(name, name)));
      let saved = '';
      try { saved = window.localStorage.getItem('shipments.recorder') || ''; } catch { /* 保存できなくても選び直せばよい */ }
      if (saved && (config.recorderNames || []).includes(saved)) select.value = saved;
    } catch {
      // 設定が読めなければ、記録のときに入荷タブを案内する
    }
  }

  function openIncoming(form) {
    const wine = form.dataset.wine;
    const bottles = Number(form.elements.bottles.value);
    const date = $('incoming-date').value;
    const recorderName = $('incoming-recorder').value;
    const row = recorderRows[wine];
    const item = data.stock.items.find((i) => i.id === wine);
    if (!Number.isInteger(bottles) || bottles < 1 || bottles > 9999) { toast('入荷した本数を1〜9999で入力してください'); form.elements.bottles.focus(); return; }
    if (!date) { toast('記入日を入れてください'); $('incoming-date').focus(); return; }
    if (!row) { toast('この銘柄は瓶詰め記録の設定に見つかりません。入荷タブから記録してください'); return; }
    pendingIncoming = { wine, rowId: row.id, bottles, date, recorderName, stockBefore: item ? item.stock : 0 };
    $('incoming-preview').textContent = `入荷記録\n記入日: ${date}\n記入者: ${recorderName || '未入力'}\n\n${wine}｜${row.wineName || (item && item.name) || '（ワイン名未設定）'}: ${num(bottles)}本\n\nSlackと在庫管理シートに記録します。`;
    $('incoming-error').hidden = true;
    $('incoming-dialog').showModal();
  }

  async function sendIncoming() {
    if (!pendingIncoming) return;
    const button = $('incoming-confirm');
    button.disabled = true;
    button.textContent = '送信中…';
    const sent = pendingIncoming;
    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'incoming', date: sent.date, recorderName: sent.recorderName, notes: '', supplier: '', items: [{ id: sent.rowId, bottles: sent.bottles, itemNote: '' }] }),
      });
      const result = await response.json().catch(() => ({}));
      if (!result.sheetsSaved) throw new Error(result.error || '記録の送信に失敗しました。');
      $('incoming-dialog').close();
      pendingIncoming = null;
      drafts.delete(sent.wine);
      recorded.set(sent.wine, { bottles: sent.bottles, date: sent.date, stockBefore: sent.stockBefore, at: Date.now() });
      toast(result.ok ? `${sent.wine} の入荷 ${num(sent.bottles)}本 をSlackと在庫管理シートへ記録しました` : result.error);
      renderStock();
      // ほかのタブの出荷ページにも知らせ、在庫シートへの反映を待って読み直す
      try { window.localStorage.setItem('stockChangedAt', `${Date.now()}:incoming`); } catch { /* 知らせられなくても読み直しは下で行う */ }
      [20, 60, 180].forEach((sec) => setTimeout(reload, sec * 1000));
    } catch (error) {
      $('incoming-error').textContent = error.message || '記録の送信に失敗しました。';
      $('incoming-error').hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = '記録を送信する';
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
    openIncoming(form);
  });
  $('incoming-recorder').addEventListener('change', () => {
    try { window.localStorage.setItem('shipments.recorder', $('incoming-recorder').value); } catch { /* 次回また選べばよい */ }
  });
  $('incoming-cancel').addEventListener('click', () => { pendingIncoming = null; $('incoming-dialog').close(); });
  $('incoming-confirm').addEventListener('click', sendIncoming);
  $('stock-copy').addEventListener('click', () => copyText(stockOrderText(), '発注リストをコピーしました'));

  $('stock-card').addEventListener('toggle', (event) => {
    if (event.target === $('stock-card')) saveOpen($('stock-card').open);
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

  loadRecorders();
  reload();
})();
