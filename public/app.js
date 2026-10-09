(() => {
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app'), nav = $('#nav'), layer = $('#layer');
const CAP = 20;
const COLORS = ['rose', 'teal', 'lav', 'peach', 'gold'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial = n => esc((n || '?').trim().charAt(0).toUpperCase());
const colorFor = id => COLORS[(id || 0) % COLORS.length];
let uid = +localStorage.getItem('memento_uid') || null;
let me = null, pollTimer = null, dismissedSugg = false, lastHeldIds = null;

const BIRD = w => `<svg width="${w}" viewBox="0 0 60 36" fill="none" stroke="#a8834a" stroke-width=".8" stroke-linejoin="round"><path d="M2 20 L30 16 L58 4 L34 22 Z" fill="#fdf9f2"/><path d="M30 16 L22 2 L34 22" fill="#f6ece0"/><path d="M34 22 L40 34 L30 16" fill="#efe2d4"/></svg>`;
const BACK = `<button class="iconbtn" onclick="history.length>1?history.back():location.hash='#/'" aria-label="Back"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M12.5 4 6.5 10l6 6"/></svg></button>`;
const FLAG = `<svg width="10" height="12" viewBox="0 0 10 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M1.5 11.5V1M1.5 1.5h7l-1.6 2.5 1.6 2.5h-7"/></svg>`;

async function api(path, opts = {}) {
  const r = await fetch(path, opts.body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(opts.body)} : {});
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401) { logout(); throw new Error('unknown user'); }
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong'); e.code = r.status; throw e; }
  return j;
}
function logout() { localStorage.removeItem('memento_uid'); uid = null; me = null; location.hash = '#/who'; }

// ---------- time
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 50) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago';
}
const weekday = () => new Date().toLocaleDateString('en-US', {weekday: 'long', timeZone: 'America/Los_Angeles'});
const longDate = () => new Date().toLocaleDateString('en-GB', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Los_Angeles'});

// ---------- bits
function ticks(n) {
  let s = ''; for (let i = 0; i < CAP; i++) { const b = i < 11 ? 'g' : i < 16 ? 'a' : 'r'; s += `<i class="${i < n ? 'on ' + b : ''}"></i>`; }
  return `<div class="ticks">${s}</div>`;
}
function wc(name, id, extra = '') { return `<div class="wc ${colorFor(id)}" ${extra}><span>${initial(name)}</span></div>`; }
function face(m, big) {
  if (m.kind === 'photo') return `<img class="photo" src="${m.image}" alt="" loading="lazy">${m.text ? `<div class="cap">${esc(m.text)}</div>` : ''}`;
  return `<div class="face"><div class="sc plum lbl">a ${m.kind}</div><div class="joke">${esc(m.text)}</div></div>`;
}
function fromLine(m) {
  if (m.from) return `from ${esc(m.from_id === uid ? 'you' : m.from)}`;
  return m.creator_id === uid ? 'made by you' : `from ${esc(m.creator)}`;
}
function count(m) { return m.hops ? `handed on <b>${m.hops}</b> time${m.hops === 1 ? '' : 's'}` : 'not yet handed on'; }
function card(m, cls = '', tilt = 0) {
  return `<a class="card ${cls}" data-id="${m.id}" href="#/m/${m.id}" style="--tilt:${tilt}deg">${face(m)}
    <div class="meta"><span class="from">${fromLine(m)}</span><span class="count">${count(m)}</span></div></a>`;
}
function toast(html, ms = 3200) {
  const t = $('#toast'); t.innerHTML = html; t.hidden = false; t.style.animation = 'none'; t.offsetHeight; t.style.animation = '';
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms);
}
function sparkle(x = innerWidth / 2, y = 60, n = 18) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i'); s.className = 'spark';
    s.style.left = x + 'px'; s.style.top = y + 'px';
    s.style.setProperty('--dx', (Math.random() * 220 - 110) + 'px'); s.style.setProperty('--dy', (Math.random() * 180 + 40) + 'px');
    s.style.animationDelay = (Math.random() * .3) + 's';
    document.body.appendChild(s); setTimeout(() => s.remove(), 2400);
  }
}
function flyBird() { const b = document.createElement('div'); b.className = 'flybird'; b.innerHTML = BIRD(64); document.body.appendChild(b); setTimeout(() => b.remove(), 1600); }
function closeLayer() { layer.innerHTML = ''; }
function modal(inner) { layer.innerHTML = `<div class="dim"></div><div class="modal" role="dialog">${inner}</div>`; $('.dim', layer).onclick = closeLayer; return $('.modal', layer); }

// ---------- data
async function refreshMe(announce = true) {
  if (!uid) return null;
  const j = await api('/api/me?uid=' + uid);
  me = j;
  const key = 'memento_seen_' + uid;
  const seen = localStorage.getItem(key);
  const newOnes = j.held.filter(m => m.from_id && m.from_id !== uid && (!seen || m.received_at > seen));
  const maxAt = j.held.reduce((a, m) => m.received_at > a ? m.received_at : a, seen || '');
  if (maxAt) localStorage.setItem(key, maxAt);
  if (announce && seen && newOnes.length) {
    const names = [...new Set(newOnes.map(m => m.from))];
    toast(`${BIRD(30)}<span>${newOnes.length === 1 ? `${esc(names[0])} handed you a memento` : `${newOnes.length} new mementos arrived`}</span>`, 4200);
    sparkle(innerWidth / 2, 70);
    j._arrived = new Set(newOnes.map(m => m.id));
  }
  return j;
}
function startPoll() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!uid || document.hidden) return;
    try {
      const before = lastHeldIds;
      const j = await refreshMe(true);
      const ids = j.held.map(m => m.id).join(',');
      if (ids !== before && route().name === 'home' && !layer.innerHTML) renderHome(j._arrived);
    } catch (e) {}
  }, 10000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && uid && route().name === 'home') render(); });

// ---------- routing
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [p, qs] = h.split('?'); const q = new URLSearchParams(qs || '');
  let m;
  if (p === '/who') return {name: 'who'};
  if (p === '/make') return {name: 'make'};
  if (p === '/journeys') return {name: 'journeys'};
  if ((m = p.match(/^\/m\/(\d+)$/))) return {name: 'hand', id: +m[1], to: +q.get('to') || null};
  if ((m = p.match(/^\/j\/(\d+)$/))) return {name: 'journey', id: +m[1]};
  return {name: 'home'};
}
async function render() {
  const r = route(); closeLayer();
  if (!uid && r.name !== 'who') { location.hash = '#/who'; return; }
  const navOn = ['home', 'make', 'journeys'].includes(r.name) || r.name === 'hand' || r.name === 'journey';
  nav.hidden = r.name === 'who'; app.classList.toggle('nonav', r.name === 'who');
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.r === r.name));
  try {
    if (r.name === 'who') return renderWho();
    await refreshMe(true);
    if (r.name === 'home') return renderHome(me._arrived);
    if (r.name === 'make') return renderMake();
    if (r.name === 'journeys') return renderJourneys();
    if (r.name === 'hand') return renderHand(r.id, r.to);
    if (r.name === 'journey') return renderJourney(r.id);
  } catch (e) {
    if (e.message !== 'unknown user') app.innerHTML = `<div class="view"><div class="empty"><div class="serif">${esc(e.message)}</div><a class="btn ghost" href="#/">Back to your mementos</a></div></div>`;
  }
}
addEventListener('hashchange', () => { scrollTo(0, 0); render(); });

// ---------- who
async function renderWho() {
  let users = [];
  try { users = (await api('/api/users')).users; } catch (e) {}
  app.innerHTML = `<div class="view">
    <div class="sc" style="margin-top:20px">memento</div>
    <h1 style="margin-top:12px">Who are <em>you?</em></h1>
    <p class="serif" style="font-style:italic;font-size:19px;color:var(--plum);margin-top:12px;line-height:1.3">One small thing a day, to keep or to hand on.</p>
    <form class="whoin" id="wf"><input id="wn" maxlength="24" autocomplete="given-name" autocapitalize="words" placeholder="Your first name" aria-label="Your name">
      <button class="btn primary" type="submit">Begin</button><div class="err" id="werr"></div></form>
    ${users.length ? `<div class="pick-l" style="margin-top:26px"><span class="sc">Already here? Tap your name</span><hr class="hair"></div>
      <div class="people">${users.map(u => `<button data-id="${u.id}">${wc(u.name, u.id)}<span>${esc(u.name)}</span></button>`).join('')}</div>` : ''}
  </div>`;
  $('#wf').onsubmit = async ev => {
    ev.preventDefault();
    try { const j = await api('/api/users', {body: {name: $('#wn').value}}); signIn(j.user.id); }
    catch (e) { $('#werr').textContent = e.message; }
  };
  app.querySelectorAll('.people button').forEach(b => b.onclick = () => signIn(+b.dataset.id));
}
function signIn(id) { uid = id; localStorage.setItem('memento_uid', id); lastHeldIds = null; startPoll(); location.hash = '#/'; }

// ---------- home
function renderHome(arrived) {
  const j = me, n = j.count;
  lastHeldIds = j.held.map(m => m.id).join(',');
  let top = '', bottom = '';
  const s = j.suggestion && !dismissedSugg ? j.suggestion : null;
  const sm = s && j.held.find(m => m.id === s.memento_id);
  if (n >= 17) {
    top = `<div class="panel firm"><div class="t"><em>Share the love</em></div>
      <div class="s">${n >= CAP ? 'Your mementos are full. Hand one on to make room for what’s coming.' : 'Your mementos are nearly full. Hand one on and make someone’s day.'}</div></div>`;
    if (sm) top += `<div class="sugg">${wc(s.to, s.to_id)}<span class="t">${esc(s.to)} might love this one</span></div>
      <a class="card hl" href="#/m/${sm.id}?to=${s.to_id}">${face(sm)}<div class="meta"><span class="from">${fromLine(sm)}</span><span class="count">${count(sm)}</span></div></a>
      <div class="acts"><button class="btn ghost" id="notnow">Not now</button><a class="btn primary" href="#/m/${sm.id}?to=${s.to_id}">Share the love</a></div>`;
    else top += `<div class="acts"><a class="btn primary" href="#/m/${j.held[j.held.length - 1].id}">Share the love</a></div>`;
  } else if (n >= 12) {
    top = `<div class="panel warm"><div class="t"><em>Pass one along?</em></div><div class="s">Your mementos are filling up. Someone could use one of these today.</div></div>`;
  } else if (n > 0) {
    bottom = `<div class="nudge">Someone could use one of these today.<small>Tap one to hand it on</small></div>`;
  }
  const rest = sm ? j.held.filter(m => m.id !== sm.id) : j.held;
  const tilts = [-2.2, 2.2, -1.4, 1.6, -2.6, 1.2];
  const grid = rest.map((m, i) => card(m, (i === 0 && !sm) || (m.kind === 'photo' && i % 5 === 0) ? 'wide' : '', tilts[i % tilts.length])).join('');
  app.innerHTML = `<div class="view">
    <div class="hdr"><div class="toprow"><span class="sc">memento · ${weekday()}</span><button class="who-link" id="sw">${esc(j.user.name)} · switch</button></div>
      <div class="row"><h1>Your <em>mementos</em></h1><span class="capn">${n} <i>of ${CAP}</i></span></div>${ticks(n)}</div>
    ${top}
    ${n === 0 ? `<div class="empty"><div class="serif">Nothing here yet.<br>Make today’s memento.</div>
       ${j.made_today ? `<p style="margin-top:12px;font-size:14px;color:var(--plum)">You’ve made today’s already. Something may arrive from a friend soon.</p>` : `<a class="btn primary" href="#/make">Make today’s memento</a>`}</div>` : ''}
    ${sm && rest.length ? `<div class="pick-l" style="margin-top:28px"><span class="sc">Also in your mementos</span><hr class="hair"></div>` : ''}
    ${rest.length ? `<div class="grid">${grid}</div>` : ''}
    ${bottom}
  </div>`;
  $('#sw').onclick = () => { if (confirm('Switch to someone else on this device?')) logout(); };
  const nn = $('#notnow'); if (nn) nn.onclick = () => { dismissedSugg = true; renderHome(); };
  if (arrived && arrived.size) arrived.forEach(id => { const c = app.querySelector(`.card[data-id="${id}"]`); if (c) c.classList.add('arrived'); });
}

// ---------- make
const IC = {
  photo: '<svg width="22" height="18" viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1.5" y="1.5" width="19" height="15" rx="1.5"/><path d="M1.5 13l5.5-5 4 4 3-2.5 6 4.5"/><circle cx="15" cy="5.5" r="1.4"/></svg>',
  note: '<svg width="22" height="18" viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M4 15.5 15.5 4a1.8 1.8 0 0 1 2.5 2.5L6.5 18"/><path d="M2 17h7"/></svg>',
  joke: '<svg width="22" height="18" viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M3 9.5c2 5 14 5 16 0"/><path d="M6 5.5h2.5M13.5 5.5H16"/></svg>'};
const draft = {kind: 'joke', text: '', image: null};
function renderMake() {
  const j = me, full = j.count >= CAP;
  let body;
  if (j.made_today) body = `<div class="kindmsg"><div class="serif">Today’s memento is made.</div><p>A new one tomorrow. Meanwhile, maybe one of yours would brighten someone’s day.</p><a class="btn ghost" href="#/">See your mementos</a></div>`;
  else if (full) body = `<div class="kindmsg"><div class="serif">Your mementos are full.</div><p>Hand one on to make room, then come back and make today’s.</p><a class="btn primary" href="#/">Share the love</a></div>`;
  else body = `
    <div class="kinds">${['photo', 'note', 'joke'].map(k => `<button class="kind ${draft.kind === k ? 'on' : ''}" data-k="${k}">${IC[k]}${k}</button>`).join('')}</div>
    ${draft.kind === 'photo' ? `<label class="pick">${draft.image ? `<img src="${draft.image}" alt=""><span class="chg">Change</span>` : `${IC.photo}<span>Choose or take a photo</span>`}
       <input type="file" accept="image/*" id="file"></label>` : ''}
    <div class="field"><textarea id="txt" rows="3" maxlength="200" placeholder="${draft.kind === 'photo' ? 'Add a few words (optional)' : draft.kind === 'joke' ? 'Tell a little joke…' : 'Write a short note…'}">${esc(draft.text)}</textarea>
      <div class="foot"><span>Make it yours</span><span id="cnt">${draft.text.length} / 140</span></div></div>
    <div class="pv-label"><span class="sc">Preview</span><hr class="hair"></div>
    <div class="card preview" id="pv"></div>
    <div class="err" id="merr"></div>
    <div class="note">Made once, then free to travel.</div>
    <button class="btn primary" id="create">Create</button>`;
  app.innerHTML = `<div class="view">
    <div class="topbar">${BACK}<span class="sc plum">${longDate()}</span><div style="width:32px"></div></div>
    <h1 style="margin-top:12px">Today’s <em>memento</em></h1>
    <div style="margin-top:12px"><span class="left sc ${j.made_today ? 'none' : ''}"><i></i>${j.made_today ? '0' : '1'} left today</span></div>
    ${body}</div>`;
  if (j.made_today || full) return;
  app.querySelectorAll('.kind').forEach(b => b.onclick = () => { draft.kind = b.dataset.k; renderMake(); });
  const txt = $('#txt'), pv = $('#pv'), cnt = $('#cnt'), btn = $('#create');
  const upd = () => {
    draft.text = txt.value; const L = [...draft.text].length;
    cnt.textContent = `${L} / 140`; cnt.classList.toggle('over', L > 140);
    const m = {kind: draft.kind, text: draft.text.trim(), image: draft.image};
    if (draft.kind === 'photo') pv.innerHTML = draft.image ? face(m) : `<div class="face"><div class="sc plum lbl">a photo</div><div class="joke" style="color:var(--plum-soft)">Your picture will appear here.</div></div>`;
    else pv.innerHTML = `<div class="face"><div class="sc plum lbl">a ${draft.kind}</div><div class="joke">${esc(m.text) || '<span style="color:var(--plum-soft)">…</span>'}</div></div>`;
    pv.innerHTML += `<div class="meta"><span class="from">by you</span><span class="count">today</span></div>`;
    btn.disabled = L > 140 || (draft.kind === 'photo' ? !draft.image : !m.text);
  };
  txt.oninput = upd; upd();
  const f = $('#file');
  if (f) f.onchange = async () => {
    const file = f.files[0]; if (!file) return;
    try { draft.image = await compress(file); renderMake(); } catch (e) { $('#merr').textContent = 'Sorry, that photo couldn’t be read. Try another?'; }
  };
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const r = await api('/api/mementos', {body: {uid, kind: draft.kind, text: draft.text.trim(), image: draft.kind === 'photo' ? draft.image : null}});
      draft.text = ''; draft.image = null;
      toast(`${BIRD(30)}<span>Made. It’s yours to keep or hand on.</span>`); sparkle(innerWidth / 2, 80);
      await refreshMe(false); location.hash = '#/'; setTimeout(() => { const c = app.querySelector(`.card[data-id="${r.memento.id}"]`); if (c) c.classList.add('arrived'); }, 120);
    } catch (e) {
      $('#merr').textContent = e.message === 'already' ? 'You’ve already made today’s memento.' : e.message === 'full' ? 'Your mementos are full. Hand one on first.' : e.message;
      btn.disabled = false; btn.textContent = 'Create';
    }
  };
}
function compress(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const W = 1200, sc = Math.min(1, W / img.naturalWidth);
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .82));
    };
    img.onerror = rej; img.src = url;
  });
}

// ---------- hand it on
async function renderHand(id, preTo) {
  const j = await api(`/api/mementos/${id}?uid=${uid}`);
  const m = j.memento;
  if (m.holder_id !== uid) { location.replace(`#/j/${id}`); return; }
  let sel = j.picker.find(p => p.id === preTo && p.eligible) ? preTo : null;
  const draw = () => {
    app.innerHTML = `<div class="view">
      <div class="topbar">${BACK}<span class="sc plum">Hand it on</span><div style="width:32px"></div></div>
      <div class="card big">${face(m)}<div class="meta"><span class="from">${fromLine(m)}</span><span class="count">${count(m)}</span></div></div>
      <a class="journeylink" href="#/j/${m.id}"><span class="link" style="color:var(--gold)">Follow its journey</span><svg width="22" height="8" viewBox="0 0 22 8" fill="none" stroke="#a8834a" stroke-width="1" stroke-linecap="round"><path d="M1 4h19" stroke-dasharray="1.2 2.6"/><path d="M17 1l3 3-3 3"/></svg></a>
      <div class="pick-l"><span class="sc">To whom?</span><hr class="hair"></div>
      ${j.picker.length ? `<div class="friends">${j.picker.map(p => `<button class="f ${sel === p.id ? 'sel' : ''} ${p.eligible ? '' : 'held'}" data-id="${p.id}" ${p.eligible ? '' : 'aria-disabled="true"'}>
          ${wc(p.name, p.id)}<span class="nm">${esc(p.name)}</span>${p.eligible ? '' : `<small>held it<br>${p.since === 1 ? '1 hand' : p.since + ' hands'} ago</small>`}</button>`).join('')}</div>`
        : `<div class="nobody">No one else is here yet.<br>Send a friend the link.</div>`}
      <div class="warn">Once you hand it on,<br>it’s theirs, not yours.</div>
      <div class="choices"><a class="btn ghost" href="#/">Keep it</a><button class="btn primary" id="go" ${sel ? '' : 'disabled'}>Hand it on</button></div>
      <button class="report" id="rep">${FLAG}Report this memento</button>
    </div>`;
    app.querySelectorAll('.f').forEach(b => b.onclick = () => {
      const p = j.picker.find(x => x.id === +b.dataset.id);
      if (!p.eligible) { toast(`<span>${esc(p.name)} held it ${p.since} hand${p.since === 1 ? '' : 's'} ago. It can return after 4.</span>`); return; }
      sel = p.id; draw();
    });
    $('#go').onclick = () => go(); $('#rep').onclick = () => report(m.id);
  };
  const go = async () => {
    const b = $('#go'); b.disabled = true; b.textContent = 'Handing on…';
    try {
      const r = await api(`/api/mementos/${m.id}/hand`, {body: {uid, to: sel}});
      if (r.bounced) {
        const md = modal(`<div class="bird">${BIRD(58)}</div><h2>Ooops, ${esc(r.name)}’s<br>hands are <em>full!</em></h2>
          <p>It’s still yours. Try someone else?</p><div class="tiny">${esc(r.name)} has 20 of 20 mementos</div>
          <button class="btn primary" id="else">Choose someone else</button><button class="alt" id="keep">Keep it for now</button>`);
        $('#else', md).onclick = () => { sel = null; closeLayer(); draw(); };
        $('#keep', md).onclick = () => { closeLayer(); location.hash = '#/'; };
        b.disabled = false; b.textContent = 'Hand it on';
        return;
      }
      flyBird(); toast(`${BIRD(30)}<span>Handed to ${esc(r.to)}. It’s theirs now.</span>`);
      setTimeout(() => { location.hash = '#/'; }, 900);
    } catch (e) { toast(`<span>${esc(e.message)}</span>`); setTimeout(render, 600); }
  };
  draw();
}
function report(mid) {
  const md = modal(`<h2 style="font-size:26px">Report this <em>memento?</em></h2><p>It goes privately to the app’s creator.</p>
    <textarea id="why" maxlength="500" placeholder="What’s wrong? (optional)"></textarea>
    <button class="btn primary" id="send">Report</button><button class="alt" id="cancel">Cancel</button>`);
  $('#cancel', md).onclick = closeLayer;
  $('#send', md).onclick = async () => {
    try { await api(`/api/mementos/${mid}/report`, {body: {uid, reason: $('#why', md).value}}); closeLayer(); toast('<span>Thank you. It’s been sent.</span>'); }
    catch (e) { toast(`<span>${esc(e.message)}</span>`); }
  };
}

// ---------- journey
function titleOf(m) {
  if (m.kind === 'photo') return m.text ? m.text : 'A photo';
  return m.text;
}
async function renderJourney(id) {
  const j = await api(`/api/mementos/${id}?uid=${uid}`);
  const m = j.memento, tl = j.timeline;
  const nm = (n, i) => i === uid ? 'You' : esc(n);
  const rows = tl.map((t, k) => {
    const last = k === tl.length - 1;
    if (t.event === 'made') return `<div class="r ${last ? 'now' : ''}"><span class="who">${nm(t.name, t.id)} <i>made it</i></span><span class="d">${ago(t.at)}</span></div>`;
    const back = tl.slice(0, k).some(x => x.id === t.id);
    return `<div class="r ${last ? 'now' : ''}"><span class="who">${last ? (t.id === uid ? 'With <i>you</i> now' : `With ${esc(t.name)} <i>now</i>`) : nm(t.name, t.id)}${back && !last ? ' <i>· again</i>' : ''}</span><span class="d">${ago(t.at)}</span></div>`;
  }).join('');
  const mine = m.creator_id === uid, home = mine && m.holder_id === uid && m.hops > 0;
  app.innerHTML = `<div class="view">
    <div class="topbar">${BACK}<span class="sc plum">Its journey</span><div style="width:32px"></div></div>
    <div class="map"><img src="/art/journey.jpg" alt=""><div class="card thumb">${m.kind === 'photo' ? `<img class="photo" src="${m.image}" alt="">` : `<div class="face"><div class="joke" style="font-size:11px">${esc(m.text.slice(0, 40))}${m.text.length > 40 ? '…' : ''}</div></div>`}</div></div>
    <h1 class="jtitle">${m.kind === 'photo' && !m.text ? 'A <em>photo</em>' : `<em>${esc(titleOf(m))}</em>`}</h1>
    <div class="tally"><span class="sc" style="align-self:center">Handed on</span><span class="n">${m.hops}</span><span class="w">time${m.hops === 1 ? '' : 's'}</span></div>
    <div class="tl">${rows}</div>
    ${m.holder_id === uid ? `<a class="btn primary" style="margin-top:26px" href="#/m/${m.id}">Hand it on</a>` : ''}
    <div class="started"><div class="serif">${mine ? `Started by you, ${ago(m.created_at)}.` : `Started by ${esc(m.creator)}, ${ago(m.created_at)}.`}</div>
      ${home ? '<span class="sc" style="display:block;margin-top:6px">It found its way home</span>' : ''}
      <div class="back">Mementos can find their way back after 4 or more hands.</div></div>
  </div>`;
}
function renderJourneys() {
  const made = me.made;
  app.innerHTML = `<div class="view">
    <div class="sc" style="margin-top:6px">Journeys</div>
    <h1 style="margin-top:12px">Where yours <em>went</em></h1>
    ${made.length ? `<div class="jlist">${made.map(m => `<a class="jrow" href="#/j/${m.id}">
        ${m.kind === 'photo' ? `<img class="th" src="${m.image}" alt="">` : `<div class="th t">“…”</div>`}
        <div style="min-width:0"><div class="ti">${m.kind === 'photo' ? (m.text ? esc(m.text) : '<i>A photo</i>') : esc(m.text)}</div>
        <div class="su">${count(m)} · ${m.holder_id === uid ? (m.hops ? 'back with you' : 'still with you') : 'now with ' + esc(m.holder)}</div></div></a>`).join('')}</div>`
      : `<div class="empty"><div class="serif">Make a memento,<br>then follow where it goes.</div><a class="btn primary" href="#/make">Make today’s memento</a></div>`}
  </div>`;
}

if (uid) startPoll();
render();
})();
