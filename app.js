'use strict';
const D = window.PVP_DATA;
const TOP_N = 50, TEAM_SIZE = 3, STALE_MS = 7 * 864e5;
const RANK_URL = 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-10000.json';
const GM_URL = 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json';
const SPRITE_URL = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
const RESULT = { w: '贏', l: '輸', d: '平' };
const TYPE_COLOR = { bug: '#92bc2c', dark: '#595761', dragon: '#0c69c8', electric: '#f2d94e', fairy: '#ee90e6', fighting: '#d3425f', fire: '#fba54c', flying: '#a1bbec', ghost: '#5f6dbc', grass: '#5fbd58', ground: '#da7c4d', ice: '#75d0c1', normal: '#a0a29f', poison: '#b763cf', psychic: '#fa8581', rock: '#c9bb8a', steel: '#5695a3', water: '#539ddf' };

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- storage ---------- */
const load = (k, fallback) => { try { const v = localStorage.getItem('pvpm.' + k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem('pvpm.' + k, JSON.stringify(v)); return true; } catch { toast('手機儲存空間無法寫入，請先到「設定」匯出備份'); return false; } };

const S = {
  tab: 'log',
  battles: load('battles', []),   // {id, t, me:[ids], opp:[ids], mv:{me:[[fast,c1,c2]…], opp:[…]}, r:'w'|'l'|'d'}
  draft: load('draft', { me: [], opp: [], moves: { me: {}, opp: {} } }), // survives switching to the game
  rank: load('rank', null),       // {at, ids, extra:{id:englishName}, sets:{id:[fast,charged,best]}}
  shields: load('shields', { me: 1, opp: 1 }),
  lastBackup: load('lastBackup', null),
  period: 'all', oppSort: 'freq', histLimit: 100, sheet: null, updating: false,
};
const saveDraft = () => save('draft', S.draft);
const rankIds = () => S.rank?.ids || D.rank;
const rankedAt = () => S.rank?.at || D.updated;

function mon(id) {
  const s = D.species[id];
  if (s) return { id, zh: s[0], form: s[1], en: s[2], types: s[3], sprite: s[4] };
  const en = S.rank?.extra?.[id] || id;
  return { id, zh: en, form: '', en, types: [], sprite: null };
}
const isShadow = id => id.endsWith('_shadow');
const formNoShadow = m => m.form.split('·').filter(f => f !== '暗影').join('·');
const fullName = id => { const m = mon(id); return m.form ? `${m.zh}（${m.form}）` : m.zh; };

/* ---------- moves ---------- */
function moveSet(id) {
  const live = S.rank?.sets?.[id];
  if (live) return { fast: live[0], charged: live[1], best: live[2] };
  const s = D.species[id];
  return s ? { fast: s[5], charged: s[6], best: s[7] } : { fast: [], charged: [], best: [] };
}
const moveName = m => D.moves[m]?.[0] || m.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const movesOf = (role, id) => S.draft.moves[role][id] || moveSet(id).best;
const sameMoves = (a, b) => a.length === b.length && a.every((m, i) => m === b[i]);
function setMoves(role, id, moves) {
  if (sameMoves(moves, moveSet(id).best)) delete S.draft.moves[role][id];
  else S.draft.moves[role][id] = moves;
  saveDraft();
}

function monHTML(id, small) {
  const m = mon(id), color = TYPE_COLOR[m.types[0]];
  const bg = color ? ` style="background:color-mix(in srgb, ${color} 34%, var(--surface2))"` : '';
  const img = m.sprite ? `<img class="sprite" src="${SPRITE_URL(m.sprite)}" alt="" loading="lazy" decoding="async">` : '';
  return `<span class="mon${small ? ' sm' : ''}${isShadow(id) ? ' shadow' : ''}"${bg}><span class="fb">${esc(m.zh[0])}</span>${img}</span>`;
}
// Drop a sprite that fails to load (offline, first run) so the name's first character shows instead.
document.addEventListener('error', e => { if (e.target.classList?.contains('sprite')) e.target.remove(); }, true);

/* ---------- toast ---------- */
let toastTimer;
function toast(text, undo) {
  clearTimeout(toastTimer);
  const el = $('#toast');
  el.innerHTML = `<div class="toast" role="status"><span>${esc(text)}</span>${undo ? '<button data-act="undo">復原</button>' : ''}</div>`;
  toast.undo = undo || null;
  toastTimer = setTimeout(() => { el.innerHTML = ''; toast.undo = null; }, undo ? 6000 : 3000);
}

/* ---------- views ---------- */
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const pct = (w, n) => n ? Math.round(w / n * 100) : 0;

function slotsHTML(role) {
  const team = S.draft[role];
  return `<div class="slots">${Array.from({ length: TEAM_SIZE }, (_, i) => {
    const id = team[i];
    if (!id) return `<button class="slot empty" data-act="pick" data-role="${role}">＋ 選擇</button>`;
    const m = mon(id), form = formNoShadow(m), [fast, ...charged] = movesOf(role, id);
    return `<div class="slot">
      <button class="slot-mon" data-act="pick" data-role="${role}" aria-label="更換${esc(fullName(id))}">${monHTML(id)}<span class="nm">${esc(m.zh)}</span>${form ? `<span class="fm">${esc(form)}</span>` : ''}</button>
      <button class="slot-moves" data-act="moves" data-role="${role}" data-id="${esc(id)}" aria-label="更改${esc(m.zh)}的招式">
        ${fast ? `<span class="f">${esc(moveName(fast))}</span>` : ''}${charged.map(c => `<span>${esc(moveName(c))}</span>`).join('')}</button>
    </div>`;
  }).join('')}</div>`;
}

/* ---------- battle rating (PvPoke random bulk simulation, runs in a worker) ---------- */
const BR_COLUMNS = [['worst', 'Worst'], ['medianLoss', 'Median<br>Loss'], ['median', 'Median'], ['medianWin', 'Median<br>Win'], ['best', 'Best']];
const BR = { worker: null, busy: null, failed: false };
const findBattle = id => S.battles.find(b => b.id === id);
const brSide = (b, role, i) => {
  const id = b[role][i];
  return { id, moves: b.mv?.[role]?.[i] || moveSet(id).best, shields: b.shields?.[role] ?? 1 };
};

function brCells(b, i, j) {
  const entry = b.br?.[`${i}-${j}`];
  if (!entry) return `<td colspan="5" class="br-wait">${BR.failed ? '無法計算' : '計算中…'}</td>`;
  if (entry.error) return '<td colspan="5" class="br-wait">這組無法計算</td>';
  return BR_COLUMNS.map(([k]) => {
    const r = entry[k];
    if (r === null) return '<td class="br-none">–</td>';
    return `<td class="${k === 'median' ? 'br-main ' : ''}${r > 500 ? 'br-w' : r < 500 ? 'br-l' : ''}">${r}</td>`;
  }).join('');
}

// The battle in the open sheet goes first, then the one just recorded.
function brNext() {
  const targets = [S.sheet?.type === 'battle' && findBattle(S.sheet.id), findBattle(S.lastId)];
  for (const b of targets) {
    if (!b) continue;
    for (let i = 0; i < b.me.length; i++) for (let j = 0; j < b.opp.length; j++) if (!b.br?.[`${i}-${j}`]) return { b, i, j };
  }
  return null;
}

function brPump() {
  if (BR.busy || BR.failed) return;
  const next = brNext();
  if (!next) return;
  if (!BR.worker) {
    BR.worker = new Worker('engine/worker.js');
    BR.worker.onmessage = ({ data }) => {
      BR.busy = null;
      const [id, i, j, sig] = data.key.split('|'), b = findBattle(id);
      if (b && sig === brSig(b)) {
        (b.br ||= {})[`${i}-${j}`] = data.error ? { error: true } : data.result;
        persistBattles();
        for (const tr of document.querySelectorAll(`tr[data-br="${id}|${i}|${j}"]`)) {
          tr.querySelectorAll('td').forEach(td => td.remove());
          tr.insertAdjacentHTML('beforeend', brCells(b, i, j));
        }
        for (const td of document.querySelectorAll(`td[data-br-cell="${id}|${i}|${j}"]`)) td.outerHTML = brBandCell(b, i, j);
      }
      brPump();
    };
    BR.worker.onerror = () => { BR.failed = true; BR.busy = null; render(); if (S.sheet?.type === 'battle') renderSheet(); };
  }
  const { b, i, j } = next;
  BR.busy = true;
  BR.worker.postMessage({ key: `${b.id}|${i}|${j}|${brSig(b)}`, me: brSide(b, 'me', i), opp: brSide(b, 'opp', j) });
}
const brSig = b => `${b.shields?.me ?? 1}${b.shields?.opp ?? 1}`;

function brRestart() {
  BR.worker?.terminate();
  BR.worker = null; BR.busy = null; BR.failed = false;
}

function shieldSeg(b, role, label) {
  const cur = b.shields?.[role] ?? 1;
  return `<div class="br-shield"><span>${label}</span><div class="seg mini" role="group" aria-label="${label}牌數">${[0, 1, 2].map(n => `<button data-act="shield" data-id="${esc(b.id)}" data-role="${role}" data-v="${n}" aria-pressed="${cur === n}">${n}</button>`).join('')}</div></div>`;
}

function brBandCell(b, i, j) {
  const entry = b.br?.[`${i}-${j}`];
  const key = `${esc(b.id)}|${i}|${j}`;
  if (!entry) return `<td data-br-cell="${key}" class="br-wait">${BR.failed ? '–' : '…'}</td>`;
  if (entry.error) return `<td data-br-cell="${key}" class="br-none">–</td>`;
  const [label, cls] = brBand(entry.median);
  return `<td data-br-cell="${key}"><span class="band ${cls}">${label}</span></td>`;
}
function brBand(r) {
  if (r >= 700) return ['大勝', 'big-win'];
  if (r >= 566) return ['小勝', 'win'];
  if (r >= 434) return ['差不多', 'even'];
  if (r >= 301) return ['小輸', 'loss'];
  return ['大輸', 'big-loss'];
}

function brMatrixHTML(b) {
  const head = id => `<div class="mx-head">${monHTML(id, true)}<span>${esc(mon(id).zh)}</span>${mon(id).form ? `<span class="fm">${esc(mon(id).form)}</span>` : ''}</div>`;
  return `<table class="br br-matrix"><thead><tr><th scope="col">我方＼對手</th>${b.opp.map(id => `<th scope="col">${head(id)}</th>`).join('')}</tr></thead>
    <tbody>${b.me.map((me, i) => {
      const m = mon(me);
      return `<tr><th scope="row"><div class="who">${monHTML(me, true)}<span class="txt">${esc(m.zh)}${m.form ? `<span class="fm">${esc(m.form)}</span>` : ''}</span></div></th>${b.opp.map((_, j) => brBandCell(b, i, j)).join('')}</tr>`;
    }).join('')}</tbody></table>`;
}

function brDetailHTML(b) {
  const groups = b.me.map((me, i) => {
    const m = mon(me);
    return `<tr class="br-group"><th colspan="6" scope="colgroup"><div class="who">${monHTML(me, true)}<span class="txt">${esc(m.zh)}${m.form ? `（${esc(m.form)}）` : ''} 對：</span></div></th></tr>
      ${b.opp.map((opp, j) => {
        const o = mon(opp);
        return `<tr data-br="${esc(b.id)}|${i}|${j}"><th scope="row"><div class="who">${monHTML(opp, true)}<span class="txt">${esc(o.zh)}${o.form ? `<span class="fm">${esc(o.form)}</span>` : ''}</span></div></th>${brCells(b, i, j)}</tr>`;
      }).join('')}`;
  }).join('');
  return `<table class="br"><thead><tr><th scope="col">對手</th>${BR_COLUMNS.map(([, l]) => `<th scope="col">${l}</th>`).join('')}</tr></thead><tbody>${groups}</tbody></table>`;
}

function battleRatingHTML(b) {
  return `<div class="team"><div class="br-title"><h2>Battle Rating<small>${S.brDetail ? '隨機模擬 1000 場的分布' : '依 1000 場模擬的 Median'}</small></h2>
      <button class="btn br-toggle" data-act="brDetail" aria-pressed="${!!S.brDetail}">${S.brDetail ? '簡表' : '詳細'}</button></div>
    <div class="br-shields">${shieldSeg(b, 'me', '我方盾')}${shieldSeg(b, 'opp', '對手盾')}</div>
    <div class="br-wrap">${S.brDetail ? brDetailHTML(b) : brMatrixHTML(b)}</div>
    <p class="note">${S.brDetail ? '高於 500 是我方贏。' : '大勝 ≥700、小勝 566～699、差不多 434～565、小輸 301～433、大輸 ≤300。'}雙方都用 PvPoke 的預設 IV，不是你的實際數值。</p></div>`;
}

function viewLog() {
  const today = S.battles.filter(b => b.t >= startOfDay());
  const w = today.filter(b => b.r === 'w').length, l = today.filter(b => b.r === 'l').length;
  const last = !S.draft.opp.length && findBattle(S.lastId);
  return `<div class="topline"><h1>大師聯盟</h1><div class="top-right"><span class="tally">今天 <b class="w">${w} 勝</b> <b class="l">${l} 敗</b></span><button class="btn backup-btn" data-act="export">備份</button></div></div>
    <section class="team"><h2>我的隊伍<small>點招式可以修改</small></h2>${slotsHTML('me')}</section>
    <section class="team"><h2>對手隊伍<small>看到幾隻選幾隻</small></h2>${slotsHTML('opp')}</section>
    ${last ? `<section class="team"><div class="last-head"><span class="pill ${last.r}">${RESULT[last.r]}</span><h2>剛剛這場</h2></div>${battleRatingHTML(last)}</section>` : ''}
    ${last ? `<div class="next-bar"><button class="btn primary" data-act="pick" data-role="opp">選下一場對手</button></div>` : `<div class="actions">
      <button class="w" data-act="result" data-v="w">贏</button>
      <button class="d" data-act="result" data-v="d">平手</button>
      <button class="l" data-act="result" data-v="l">輸</button>
    </div>`}`;
}

function filtered() {
  const from = { today: startOfDay(), d7: startOfDay() - 6 * 864e5, d30: startOfDay() - 29 * 864e5, all: 0 }[S.period];
  return S.battles.filter(b => b.t >= from);
}
function tally(list) {
  const out = new Map();
  for (const [key, b] of list) {
    const a = out.get(key) || { key, n: 0, w: 0, l: 0, d: 0 };
    a.n++; a[b.r]++; out.set(key, a);
  }
  return [...out.values()];
}
const recText = a => `${a.w}勝 ${a.l}敗${a.d ? ` ${a.d}平` : ''}`;
function rateHTML(a) {
  const p = pct(a.w, a.n), cls = a.n >= 3 ? (p < 40 ? ' lo' : p >= 60 ? ' hi' : '') : '';
  return `<span class="rate${cls}">${p}%</span>`;
}

function viewStats() {
  const list = filtered();
  const periods = { today: '今天', d7: '7 天', d30: '30 天', all: '全部' };
  const head = `<div class="topline"><h1>統計</h1></div>
    <div class="seg" role="group" aria-label="時間範圍">${Object.entries(periods).map(([k, v]) => `<button data-act="period" data-v="${k}" aria-pressed="${k === S.period}">${v}</button>`).join('')}</div>`;
  if (!list.length) return head + `<div class="empty-state"><span>這個範圍還沒有紀錄。打完一場後，到「紀錄」按贏或輸，勝率就會出現在這裡。</span><button class="btn primary" data-act="tab" data-v="log">去記錄</button></div>`;
  const [all] = tally(list.map(b => ['all', b]));
  const opp = tally(list.flatMap(b => [...new Set(b.opp)].map(id => [id, b])));
  const teams = tally(list.map(b => [[...b.me].sort().join('|'), b])).sort((a, b) => b.n - a.n).slice(0, 10);
  const minHard = 3;
  const hardMode = S.oppSort === 'hard';
  const oppRows = (hardMode ? opp.filter(a => a.n >= minHard).sort((a, b) => a.w / a.n - b.w / b.n || b.n - a.n) : opp.sort((a, b) => b.n - a.n)).slice(0, 20);
  return head + `
    <div class="hero"><div><div class="pct">${pct(all.w, all.n)}<small>%</small></div><div class="cap">勝率，共 ${all.n} 場</div></div>
      <div class="wld"><span>贏</span><b>${all.w}</b><span>輸</span><b>${all.l}</b><span>平手</span><b>${all.d}</b></div></div>
    <div class="section-head"><h2>對手寶可夢</h2>
      <div class="seg mini" role="group" aria-label="排序"><button data-act="oppSort" data-v="freq" aria-pressed="${!hardMode}">最常遇到</button><button data-act="oppSort" data-v="hard" aria-pressed="${hardMode}">最難打</button></div></div>
    ${oppRows.length ? `<div class="rows">${oppRows.map(a => {
      const m = mon(a.key);
      return `<div class="row"><div class="who">${monHTML(a.key, true)}<span class="txt">${esc(m.zh)}${m.form ? `<span class="fm">${esc(m.form)}</span>` : ''}</span></div><span class="rec">${recText(a)}</span>${rateHTML(a)}</div>`;
    }).join('')}</div>` : `<p class="note">遇到同一隻 ${minHard} 次以上才列入「最難打」，樣本太少的勝率參考價值不高。</p>`}
    <div class="section-head"><h2>我的隊伍</h2></div>
    <div class="rows">${teams.map(a => {
      const ids = a.key.split('|');
      return `<div class="row"><div class="who"><span class="trio">${ids.map(id => monHTML(id, true)).join('')}</span><span class="txt">${esc(ids.map(id => mon(id).zh).join('、'))}</span></div><span class="rec">${recText(a)}</span>${rateHTML(a)}</div>`;
    }).join('')}</div>`;
}

function viewHistory() {
  const list = [...S.battles].sort((a, b) => b.t - a.t);
  const head = `<div class="topline"><h1>歷史</h1><span class="tally">共 ${list.length} 場</span></div>`;
  if (!list.length) return head + `<div class="empty-state"><span>還沒有對戰紀錄。</span><button class="btn primary" data-act="tab" data-v="log">去記錄</button></div>`;
  const shown = list.slice(0, S.histLimit), days = new Map();
  for (const b of shown) { const k = startOfDay(b.t); (days.get(k) || days.set(k, []).get(k)).push(b); }
  const html = [...days].map(([k, items]) => {
    const w = items.filter(b => b.r === 'w').length, l = items.filter(b => b.r === 'l').length;
    const label = new Date(k).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
    return `<div class="day"><span>${label}</span><span>${w} 勝 ${l} 敗</span></div><div class="rows">${items.map(b => `
      <button class="battle" data-act="battle" data-id="${esc(b.id)}" aria-label="${RESULT[b.r]}，${esc(b.me.map(fullName).join('、'))} 對 ${esc(b.opp.map(fullName).join('、'))}">
        <span class="pill ${b.r}">${RESULT[b.r]}</span>
        <span class="vs"><span class="trio">${b.me.map(id => monHTML(id, true)).join('')}</span>對<span class="trio">${b.opp.map(id => monHTML(id, true)).join('')}</span></span>
        <span class="time">${new Date(b.t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      </button>`).join('')}</div>`;
  }).join('');
  return head + html + (list.length > shown.length ? `<button class="btn" data-act="more">顯示更多</button>` : '');
}

function viewSettings() {
  return `<div class="topline"><h1>設定</h1></div>
    <section class="team"><h2>PvPoke 排名與招式</h2><div class="rows">
      <div class="set-row"><div>大師聯盟<div class="sub">${S.updating ? '更新中…' : `${new Date(rankedAt()).toLocaleDateString('zh-TW')} 的資料，共 ${rankIds().length} 隻`}</div></div>
      <button class="btn" data-act="refresh" ${S.updating ? 'disabled' : ''}>更新</button></div></div>
      <p class="note">連上網路時，超過 7 天的資料會自動更新。選單列出前 ${TOP_N} 名，其他寶可夢可以用搜尋找。招式預設為 PvPoke 的推薦配招。</p></section>
    <section class="team"><h2>備份</h2><div class="rows">
      <div class="set-row"><div>匯出紀錄<div class="sub">共 ${S.battles.length} 場，${S.lastBackup ? `上次備份 ${new Date(S.lastBackup).toLocaleDateString('zh-TW')}` : '還沒備份過'}</div></div><button class="btn" data-act="export">匯出</button></div>
      <div class="set-row"><div>匯入紀錄<div class="sub">合併進現有紀錄，重複的不會多算</div></div><button class="btn" data-act="import">匯入</button></div></div>
      <p class="note">紀錄只存在這支手機上，刪除 App 或清除瀏覽器資料就會消失，換手機前請先匯出。</p></section>
    <p class="note">排名、招式與對戰模擬引擎來自 PvPoke（MIT 授權），名稱與圖片來自 PokeAPI。寶可夢相關名稱與圖像的權利屬於其原權利人，本 App 為非官方的個人工具。</p>`;
}

const VIEWS = { log: viewLog, stats: viewStats, history: viewHistory, settings: viewSettings };
const TAB_NAMES = { log: '紀錄', stats: '統計', history: '歷史', settings: '設定' };
function render() {
  const v = $('#view'), keep = v.dataset.tab === S.tab ? v.scrollTop : 0;
  v.innerHTML = `<div class="wrap-narrow" style="flex:1">${VIEWS[S.tab]()}</div>`;
  v.dataset.tab = S.tab;
  v.scrollTop = keep;
  $('#tabs').innerHTML = Object.entries(TAB_NAMES).map(([k, n]) => `<button data-act="tab" data-v="${k}"${k === S.tab ? ' aria-current="page"' : ''}>${n}</button>`).join('');
  brPump();
}

/* ---------- picker ---------- */
function usualFor(role) {
  const count = new Map();
  for (const b of S.battles) for (const id of b[role]) count.set(id, (count.get(id) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
}
function tileHTML(id, team, rank) {
  const m = mon(id), i = team.indexOf(id), form = formNoShadow(m);
  return `<button class="tile" data-act="toggle" data-id="${esc(id)}" aria-pressed="${i >= 0}" aria-label="${esc(fullName(id))}">
    ${rank ? `<span class="rk">${rank}</span>` : ''}${i >= 0 ? `<span class="ord">${i + 1}</span>` : ''}
    ${monHTML(id)}<span class="nm">${esc(m.zh)}</span>${form ? `<span class="fm">${esc(form)}</span>` : ''}</button>`;
}
function pickerBody() {
  const { role, q } = S.sheet, team = S.draft[role], ids = rankIds();
  const query = (q || '').trim().toLowerCase();
  const pos = new Map(ids.map((id, i) => [id, i + 1]));
  if (query) {
    const hits = ids.filter(id => { const m = mon(id); return (m.zh + m.form + m.en + id).toLowerCase().includes(query); }).slice(0, 60);
    return hits.length ? `<h3>搜尋結果（數字是排名）</h3><div class="grid">${hits.map(id => tileHTML(id, team, pos.get(id))).join('')}</div>`
      : `<p class="note">找不到「${esc(q)}」。可以輸入中文或英文名稱的一部分。</p>`;
  }
  const usual = usualFor(role);
  return `${usual.length ? `<h3>${role === 'me' ? '我常用' : '常遇到'}</h3><div class="grid">${usual.map(id => tileHTML(id, team, pos.get(id))).join('')}</div>` : ''}
    <h3>PvPoke 前 ${TOP_N} 名</h3><div class="grid">${ids.slice(0, TOP_N).map((id, i) => tileHTML(id, team, i + 1)).join('')}</div>`;
}
function pickerPicked() {
  const team = S.draft[S.sheet.role];
  return team.length ? team.map(id => `<span class="chip">${esc(fullName(id))}</span>`).join('') : '點寶可夢加入，再點一次取消';
}
function refreshPicker() {
  const body = $('#pickBody'), top = body.scrollTop;
  body.innerHTML = pickerBody();
  body.scrollTop = top;
  $('#picked').innerHTML = pickerPicked();
}

function moveButton(act, m, selected, isBest) {
  const color = TYPE_COLOR[D.moves[m]?.[1]] || 'var(--muted)';
  return `<button class="mv" data-act="${act}" data-v="${esc(m)}" aria-pressed="${selected}"><span class="dot" style="background:${color}"></span><span>${esc(moveName(m))}</span>${isBest ? '<span class="tag">推薦</span>' : ''}</button>`;
}
function movesSheetHTML() {
  const { role, id } = S.sheet, set = moveSet(id), [fast, ...charged] = movesOf(role, id);
  return `<div class="sheet-head"><h2>${esc(fullName(id))}</h2><button class="btn primary" data-act="close">完成</button></div>
    <div class="team"><h2>快速招式</h2><div class="mv-list">${set.fast.map(m => moveButton('setFast', m, m === fast, m === set.best[0])).join('')}</div></div>
    <div class="team"><h2>蓄力招式<small>最多 2 招</small></h2><div class="mv-list">${set.charged.map(m => moveButton('toggleCharged', m, charged.includes(m), set.best.slice(1).includes(m))).join('')}</div></div>
    <button class="btn" data-act="resetMoves">恢復推薦招式</button>`;
}
function battleTeamHTML(title, ids, moves) {
  return `<div class="team"><h2>${title}</h2>${ids.map((id, i) => `<div><div>${esc(fullName(id))}</div>${moves?.[i] ? `<div class="mv-line">${esc(moves[i].map(moveName).join('、'))}</div>` : ''}</div>`).join('')}</div>`;
}
function renderSheet() {
  const o = $('#overlay'), sh = S.sheet;
  if (!sh) { o.innerHTML = ''; return; }
  if (sh.type === 'picker') {
    o.innerHTML = `<div class="scrim" data-act="closeScrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="選擇寶可夢">
      <div class="sheet-head"><h2>${sh.role === 'me' ? '我的隊伍' : '對手隊伍'}</h2><button class="btn primary" data-act="close">完成</button></div>
      <input class="search" id="pickSearch" type="search" placeholder="搜尋全部寶可夢（中文或英文）" autocomplete="off" aria-label="搜尋寶可夢">
      <div class="picked" id="picked"></div>
      <div class="pick-body" id="pickBody"></div></div></div>`;
    refreshPicker();
  } else if (sh.type === 'moves') {
    const top = o.querySelector('.sheet')?.scrollTop || 0;
    o.innerHTML = `<div class="scrim" data-act="closeScrim"><div class="sheet auto" role="dialog" aria-modal="true" aria-label="選擇招式">${movesSheetHTML()}</div></div>`;
    o.querySelector('.sheet').scrollTop = top;
  } else {
    const b = findBattle(sh.id);
    if (!b) { S.sheet = null; o.innerHTML = ''; return; }
    const top = o.querySelector('.sheet')?.scrollTop || 0;
    o.innerHTML = `<div class="scrim" data-act="closeScrim"><div class="sheet auto" role="dialog" aria-modal="true" aria-label="對戰詳情">
      <div class="sheet-head"><h2>${new Date(b.t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</h2><button class="btn" data-act="close">關閉</button></div>
      ${battleTeamHTML('我的隊伍', b.me, b.mv?.me)}
      ${battleTeamHTML('對手隊伍', b.opp, b.mv?.opp)}
      ${battleRatingHTML(b)}
      <div class="team"><h2>結果</h2><div class="result-pick">${Object.entries({ w: '贏', d: '平手', l: '輸' }).map(([k, v]) => `<button class="${k}" data-act="setResult" data-v="${k}" aria-pressed="${b.r === k}">${v}</button>`).join('')}</div></div>
      <button class="btn danger${sh.armed ? ' armed' : ''}" data-act="delete">${sh.armed ? '再按一次確認刪除' : '刪除這場紀錄'}</button></div></div>`;
    o.querySelector('.sheet').scrollTop = top;
    brPump();
  }
}

/* ---------- actions ---------- */
function persistBattles() { return save('battles', S.battles); }

function recordResult(r) {
  const d = S.draft;
  if (!d.me.length) { toast('先選我的隊伍'); return; }
  if (!d.opp.length) { toast('先選至少一隻對手'); return; }
  const b = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(), me: [...d.me], opp: [...d.opp],
    mv: { me: d.me.map(id => [...movesOf('me', id)]), opp: d.opp.map(id => [...movesOf('opp', id)]) }, shields: { ...S.shields }, r,
  };
  const prevOpp = d.opp, prevMoves = d.moves.opp;
  S.battles.push(b);
  d.opp = [];
  d.moves.opp = {};
  const prevLast = S.lastId;
  S.lastId = b.id;
  persistBattles(); saveDraft();
  render();
  $('.last-head')?.scrollIntoView({ block: 'start' });
  toast(`已記錄：${RESULT[r]}`, () => {
    S.battles = S.battles.filter(x => x.id !== b.id);
    d.opp = prevOpp;
    d.moves.opp = prevMoves;
    S.lastId = prevLast;
    persistBattles(); saveDraft(); render();
    $('#view').scrollTop = 0;
    toast('已復原');
  });
}

async function refreshRanks(silent) {
  if (S.updating) return;
  S.updating = true;
  if (S.tab === 'settings') render();
  try {
    const res = await fetch(RANK_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length < TOP_N) throw new Error('bad data');
    const extra = {}, sets = {};
    const byUses = list => [...list].sort((a, b) => (b.uses || 0) - (a.uses || 0)).map(m => m.moveId).filter(m => m !== 'none');
    for (const r of rows) {
      if (!D.species[r.speciesId]) extra[r.speciesId] = r.speciesName;
      sets[r.speciesId] = [byUses(r.moves.fastMoves), byUses(r.moves.chargedMoves), r.moveset.filter(m => m !== 'none')];
    }
    S.rank = { at: Date.now(), ids: rows.map(r => r.speciesId), extra, sets };
    save('rank', S.rank);
    // Refresh the simulator's stats and moves too, so ratings keep up with game balance changes.
    const gmRes = await fetch(GM_URL, { cache: 'no-store' }).catch(() => null);
    if (gmRes?.ok) { await (await caches.open('pvpm-gm')).put('engine/gamemaster-live', gmRes); brRestart(); }
    if (!silent) toast('排名與招式已更新');
  } catch {
    if (!silent) toast('更新失敗，請確認網路連線後再試一次');
  }
  S.updating = false;
  render();
  if (S.sheet?.type === 'picker') refreshPicker();
}

function markBackedUp(message) {
  S.lastBackup = Date.now();
  save('lastBackup', S.lastBackup);
  render();
  toast(message);
}

async function exportData() {
  if (!S.battles.length) { toast('還沒有紀錄可以備份'); return; }
  const name = `pvp-master-log-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify({ app: 'pvp-log-master', version: 1, masterBattles: S.battles }, null, 1)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); markBackedUp('備份完成'); return; }
  } catch (e) { if (e.name === 'AbortError') { toast('已取消備份'); return; } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  markBackedUp('備份檔已下載');
}

async function importData(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const rows = parsed.masterBattles; // the Great League app uses another key, so its backups are refused here
    const isValid = b => b && typeof b.id === 'string' && Number.isFinite(b.t) && RESULT[b.r] && Array.isArray(b.me) && Array.isArray(b.opp) && [...b.me, ...b.opp].every(x => typeof x === 'string');
    if (!Array.isArray(rows) || !rows.every(isValid)) throw new Error();
    const seen = new Set(S.battles.map(b => b.id));
    const fresh = rows.filter(b => !seen.has(b.id));
    S.battles.push(...fresh);
    persistBattles(); render();
    toast(`匯入 ${fresh.length} 場，略過 ${rows.length - fresh.length} 場重複`);
  } catch { toast('這個檔案不是 PvP 大師戰績本的備份，沒有匯入任何資料'); }
}

const ACTIONS = {
  tab: el => { S.tab = el.dataset.v; render(); },
  period: el => { S.period = el.dataset.v; render(); },
  oppSort: el => { S.oppSort = el.dataset.v; render(); },
  more: () => { S.histLimit += 100; render(); },
  brDetail: () => { S.brDetail = !S.brDetail; render(); if (S.sheet?.type === 'battle') renderSheet(); },
  shield: el => {
    const b = findBattle(el.dataset.id), role = el.dataset.role, v = +el.dataset.v;
    b.shields = { me: b.shields?.me ?? 1, opp: b.shields?.opp ?? 1, [role]: v };
    delete b.br;
    S.shields[role] = v;
    save('shields', S.shields); persistBattles();
    render();
    if (S.sheet?.type === 'battle') renderSheet();
  },
  pick: el => { S.sheet = { type: 'picker', role: el.dataset.role, q: '' }; renderSheet(); },
  moves: el => { S.sheet = { type: 'moves', role: el.dataset.role, id: el.dataset.id }; renderSheet(); },
  close: () => { S.sheet = null; renderSheet(); render(); if (!findBattle(S.lastId) || S.draft.opp.length) $('#view').scrollTop = 0; },
  closeScrim: (el, e) => { if (e.target === el) ACTIONS.close(); },
  toggle: el => {
    const team = S.draft[S.sheet.role], id = el.dataset.id, i = team.indexOf(id);
    if (i >= 0) team.splice(i, 1);
    else if (team.length >= TEAM_SIZE) { toast('一隊最多 3 隻，先取消一隻'); return; }
    else team.push(id);
    saveDraft();
    if (team.length === TEAM_SIZE && i < 0) { ACTIONS.close(); return; }
    refreshPicker();
  },
  setFast: el => {
    const { role, id } = S.sheet, [, ...charged] = movesOf(role, id);
    setMoves(role, id, [el.dataset.v, ...charged]);
    renderSheet();
  },
  toggleCharged: el => {
    const { role, id } = S.sheet, [fast, ...charged] = movesOf(role, id), m = el.dataset.v;
    if (charged.includes(m)) {
      if (charged.length === 1) { toast('至少要留一招蓄力招式'); return; }
      charged.splice(charged.indexOf(m), 1);
    } else {
      if (charged.length >= 2) charged.shift(); // a third pick replaces the earlier of the two
      charged.push(m);
    }
    setMoves(role, id, [fast, ...charged]);
    renderSheet();
  },
  resetMoves: () => { const { role, id } = S.sheet; setMoves(role, id, moveSet(id).best); renderSheet(); },
  result: el => recordResult(el.dataset.v),
  undo: () => { const u = toast.undo; $('#toast').innerHTML = ''; toast.undo = null; u?.(); },
  battle: el => { S.sheet = { type: 'battle', id: el.dataset.id, armed: false }; renderSheet(); },
  setResult: el => { const b = S.battles.find(x => x.id === S.sheet.id); b.r = el.dataset.v; persistBattles(); renderSheet(); render(); },
  delete: () => {
    if (!S.sheet.armed) { S.sheet.armed = true; renderSheet(); return; }
    S.battles = S.battles.filter(x => x.id !== S.sheet.id);
    persistBattles(); S.sheet = null; renderSheet(); render(); toast('已刪除');
  },
  refresh: () => refreshRanks(),
  export: exportData,
  import: () => $('#importFile').click(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  ACTIONS[el.dataset.act]?.(el, e);
});
document.addEventListener('input', e => {
  if (e.target.id === 'pickSearch') { S.sheet.q = e.target.value; const b = $('#pickBody'); b.innerHTML = pickerBody(); b.scrollTop = 0; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) ACTIONS.close(); });
$('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; });

render();
if (navigator.onLine && Date.now() - rankedAt() > STALE_MS) refreshRanks(true);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
