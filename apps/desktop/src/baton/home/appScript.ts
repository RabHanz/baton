/**
 * The page script of Baton's window (D140). Plain DOM, no framework. Text goes in with textContent
 * only; the state is data, never markup (the one innerHTML is the mark Baton itself draws, and the
 * fixed icon paths below). Outside Electron it reads `window.__BATON_STATE__`, so every tab can be
 * looked at in a browser. This string holds no backticks and no dollar-brace, on purpose.
 */
export const APP_SCRIPT = `
const real = typeof require === 'function';
const ipc = real ? require('electron').ipcRenderer : null;
const get = () => real ? ipc.invoke('baton-home:get') : Promise.resolve(window.__BATON_STATE__);
const set = (id, v) => real ? ipc.invoke('baton-home:set', id, v).then(render) : Promise.resolve();
const $ = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
const ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  sessions: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="18" height="5" rx="1.5"/><path d="M7 20h10"/>',
  dictation: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  assistant: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>',
  voice: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  usage: '<path d="M4 19V9M10 19V5M16 19v-8M22 19H2"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  checks: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  side: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  chev: '<path d="M1 1l4 4 4-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>'
};
const icon = (n, size) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'i'); s.setAttribute('viewBox', '0 0 24 24'); if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; } s.innerHTML = ICON[n] || ''; return s; };
const TABS = [['home','Home'],['sessions','Sessions'],['dictation','Dictation'],['history','History'],['assistant','Assistant'],['voice','Voice'],['screen','Screen'],['usage','Usage'],['checks','Checks']];
const INTRO = {
  sessions: ['Sessions', 'Every live session on every connected machine. Open one, or type to it.'],
  dictation: ['Dictation', 'Talk into any app. Your words stay on this computer.'],
  history: ['History', 'Everything you said and what it became. Kept on this computer, forever, until you delete it.'],
  assistant: ['Assistant', 'What Baton works through, whose subscription it uses, and what it may do without asking.'],
  voice: ['Voice', 'How Baton hears you and how it sounds back.'],
  screen: ['Screen', 'When Baton may look at your screen, and how to stop it.'],
  usage: ['Usage', 'How much of each account is left.'],
  checks: ['Checks', 'See what is wrong without reading a log.']
};
let cur = 'home', collapsed = false, modal = null, S = null;
const open = new Set(), shown = new Set(), drafts = new Map(), changing = new Set();

function control(c) {
  if (c.kind === 'toggle') { const b = $('button', 'sw'); b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(c.on)); b.setAttribute('aria-label', c.label); b.onclick = () => set(c.id, !c.on); return b; }
  if (c.kind === 'choice') {
    if (c.options.length <= 3 && c.options.reduce((n, o) => n + o.label.length, 0) <= 32) {
      const s = $('div', 'seg'); for (const o of c.options) { const b = $('button', null, o.label); b.setAttribute('aria-pressed', String(o.value === c.value)); b.onclick = () => set(c.id, o.value); s.appendChild(b); } return s;
    }
    if (c.options.some(o => o.note)) {
      const list = $('div', 'brain');
      for (const o of c.options) { const r = $('button', 'pick' + (o.value === c.value ? ' on' : '')); r.setAttribute('role', 'radio'); r.setAttribute('aria-checked', String(o.value === c.value)); const t = $('div', 'text'); t.append($('div', 'label', o.label), $('div', 'hint', o.note || '')); r.append($('span', 'radio'), t); r.onclick = () => set(c.id, o.value); list.appendChild(r); }
      return list;
    }
    const s = $('select'); s.setAttribute('aria-label', c.label);
    for (const o of c.options) { const p = $('option', null, o.label); p.value = o.value; p.selected = o.value === c.value; s.appendChild(p); }
    s.onchange = () => set(c.id, s.value); return s;
  }
  if (c.kind === 'secret') { const b = $('button', 'btn', shown.has(c.id) ? c.revealed : c.masked); b.setAttribute('aria-label', 'Show address'); b.onclick = () => { if (shown.has(c.id)) shown.delete(c.id); else shown.add(c.id); b.textContent = shown.has(c.id) ? c.revealed : c.masked; }; return b; }
  const b = $('button', 'btn', c.button); b.onclick = () => set(c.id, null);
  if (c.secondary) { const w = $('div', 'pair'); const b2 = $('button', 'btn', c.secondary); b2.onclick = () => set(c.id + ':later', null); w.append(b2, b); return w; }
  return b;
}
function brain(c) {
  const list = $('div', 'brain');
  for (const o of c.options) {
    const r = $('button', 'pick' + (o.value === c.value ? ' on' : '')); r.disabled = o.state !== 'ready';
    r.setAttribute('role', 'radio'); r.setAttribute('aria-checked', String(o.value === c.value));
    const t = $('div', 'text'); const l = $('div', 'label', o.label); if (o.state === 'soon') l.appendChild($('span', 'tag2', 'Coming soon'));
    t.append(l, $('div', 'hint', o.note)); r.append($('span', 'radio'), t);
    if (o.state === 'ready') r.onclick = () => set(c.id, o.value);
    list.appendChild(r);
  }
  return list;
}
function session(c) {
  const r = $('div', 'row sess'); const dot = $('span', 'sdot ' + c.state); dot.setAttribute('aria-label', c.stateLabel);
  const t = $('div', 'text'); const name = $(c.canOpen ? 'button' : 'div', 'sname', c.label);
  if (c.canOpen) { name.title = 'Open in sessions'; name.onclick = () => set(c.id, null); }
  const meta = $('div', 'hint'); meta.append(document.createTextNode(c.project + ' \\u00b7 ' + c.box + ' \\u00b7 ' + c.stateLabel));
  if (c.masked) { meta.append(document.createTextNode(' \\u00b7 ')); const a = $('button', 'reveal', shown.has(c.id) ? c.revealed : c.masked); a.setAttribute('aria-label', 'Show account'); a.onclick = () => { if (shown.has(c.id)) shown.delete(c.id); else shown.add(c.id); a.textContent = shown.has(c.id) ? c.revealed : c.masked; }; meta.append(a); }
  t.append(name, meta);
  if (c.canSend) {
    const f = $('form', 'send'); const i = $('input'); i.type = 'text'; i.id = 'in-' + c.id; i.placeholder = 'Send to this session'; i.setAttribute('aria-label', 'Send to ' + c.label); i.value = drafts.get(c.id) || '';
    i.oninput = () => drafts.set(c.id, i.value);
    f.onsubmit = e => { e.preventDefault(); const v = i.value.trim(); if (!v) return; drafts.delete(c.id); i.value = ''; set(c.id, v); };
    f.append(i, $('button', 'btn', 'Send')); t.append(f);
  }
  r.append(dot, t); return r;
}
function check(c) {
  const r = $('div', 'row'); r.style.justifyContent = 'flex-start';
  const g = $('span', 'glyph ' + c.status, c.status === 'ok' ? '\\u2713' : c.status === 'warn' ? '!' : '\\u00d7');
  g.setAttribute('aria-label', c.status === 'ok' ? 'Fine' : c.status === 'warn' ? 'Worth a look' : 'Needs fixing');
  const t = $('div', 'text'); t.appendChild($('div', 'label', c.label)); t.appendChild($('div', 'hint', c.detail)); if (c.fix) t.appendChild($('div', 'fix', c.fix));
  r.append(g, t); return r;
}
function valueOf(c) { const o = c.options.find(x => x.value === c.value); return o ? o.label : String(c.value || ''); }
function choiceRow(c) {
  const wrap = $('div', 'rowwrap'); if (c.disabled) wrap.setAttribute('data-disabled', '');
  const r = $('div', 'row'); const t = $('div', 'text'); t.appendChild($('div', 'label', c.label));
  t.appendChild($('div', 'hint', valueOf(c) + (c.hint ? ' \u00b7 ' + c.hint : '')));
  const b = $('button', 'btn quiet', changing.has(c.id) ? 'Done' : 'Change'); b.setAttribute('aria-expanded', String(changing.has(c.id)));
  b.onclick = () => { if (changing.has(c.id)) changing.delete(c.id); else changing.add(c.id); render(); };
  r.append(t, b); wrap.appendChild(r);
  if (changing.has(c.id)) { const i = $('div', 'inline'); const ctl = control(c); i.appendChild(ctl); wrap.appendChild(i); }
  return wrap;
}
function wakeRow(items) {
  const wrap = $('div', 'rowwrap'); const r = $('div', 'row'); const t = $('div', 'text'); t.appendChild($('div', 'label', 'Wake words'));
  const on = items.filter(x => x.on).map(x => x.label.replace(/^Wake word: /, ''));
  t.appendChild($('div', 'hint', on.length ? on.join(', ') : 'None on'));
  const b = $('button', 'btn quiet', changing.has('wake') ? 'Done' : 'Change'); b.onclick = () => { if (changing.has('wake')) changing.delete('wake'); else changing.add('wake'); render(); };
  r.append(t, b); wrap.appendChild(r);
  if (changing.has('wake')) { const i = $('div', 'inline wakes'); for (const x of items) { const l = $('label', 'wk'); l.append($('span', null, x.label.replace(/^Wake word: /, '')), control(x)); i.appendChild(l); } wrap.appendChild(i); }
  return wrap;
}
function row(c) {
  if (c.kind === 'choice' && (c.options.length > 2 || c.options.reduce((n, o) => n + o.label.length, 0) > 26)) return choiceRow(c);
  if (c.kind === 'session') return session(c);
  if (c.kind === 'check') return check(c);
  if (c.kind === 'brain') { const r = $('div', 'brainRow'); if (c.hint) r.appendChild($('div', 'hint', c.hint)); r.appendChild(brain(c)); return r; }
  const r = $('div', 'row'); if (c.disabled) r.setAttribute('data-disabled', '');
  const t = $('div', 'text'); t.appendChild($('div', 'label', c.label)); if (c.hint) t.appendChild($('div', 'hint', c.hint));
  r.append(t, control(c)); return r;
}
function rowsOf(list, host) {
  const wakes = list.filter(x => x.id.indexOf('v.wake:') === 0); let done = false;
  for (const c of list) { if (c.id.indexOf('v.wake:') === 0) { if (!done) { done = true; host.appendChild(wakeRow(wakes)); } continue; } host.appendChild(row(c)); }
}
function group(name, items) {
  const g = $('div', 'group' + (open.has(name) ? ' open' : ''));
  rowsOf(items.filter(x => !x.more), g);
  const more = items.filter(x => x.more);
  if (more.length) {
    const w = $('div', 'more'), i = $('div'); rowsOf(more, i); w.appendChild(i); g.appendChild(w);
    const ml = (more.find(x => x.moreLabel) || {}).moreLabel || 'More options', fl = ml === 'Show all' ? 'Show fewer' : 'Fewer options';
    const b = $('button', 'moreBtn'); b.setAttribute('aria-expanded', String(open.has(name))); const sp = $('span', null, open.has(name) ? fl : ml); b.append(sp, icon('chev', 10));
    b.onclick = () => { if (open.has(name)) open.delete(name); else open.add(name); g.classList.toggle('open'); b.setAttribute('aria-expanded', String(open.has(name))); sp.textContent = open.has(name) ? fl : ml; };
    g.appendChild(b);
  }
  return g;
}
function sections(items) {
  const out = []; for (const c of items) { let s = out.find(x => x.name === c.section); if (!s) { s = { name: c.section, items: [], lead: false }; out.push(s); } if (c.lead) s.lead = true; s.items.push(c); }
  out.sort((a, b) => Number(b.lead) - Number(a.lead)); return out;
}
function tabControls(tab) { return S.controls.filter(c => c.tab === tab); }
function find(id) { return S.controls.find(c => c.id === id); }

function greeting() { const h = new Date().getHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
function chipEl(t, plain) { return $('span', 'chip' + (plain ? ' plain' : ''), t); }
function pageHead(title, lede) { const f = document.createDocumentFragment(); f.appendChild($('h1', null, title)); if (lede) f.appendChild($('p', 'lede', lede)); return f; }
function banner(kind, em, title, text, btn, onclick) {
  const b = $('div', 'banner' + (kind ? ' ' + kind : '')); const d = $('div'); const h = $('h3'); h.append(document.createTextNode(title + ' ')); h.appendChild($('em', null, em)); d.append(h, $('p', null, text)); b.appendChild(d);
  if (btn) { const x = $('button', 'btn', btn); x.onclick = onclick; b.appendChild(x); }
  return b;
}
function dayLabel(iso) { const d = new Date(iso), t = new Date(); const same = (a, b) => a.toDateString() === b.toDateString(); const y = new Date(t); y.setDate(t.getDate() - 1); return same(d, t) ? 'Today' : same(d, y) ? 'Yesterday' : d.toLocaleDateString([], { month: 'long', day: 'numeric' }); }
function clock(iso) { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

function home(p) {
  const x = S.extra || {}; const words = x.wakeWords || [];
  const h = $('h1'); h.append(document.createTextNode(greeting() + '. '));
  if (words.length) { h.appendChild($('em', null, 'Say ')); words.slice(0, 2).forEach((w, i) => { if (i) h.append(document.createTextNode(' or ')); h.appendChild(chipEl(w)); }); h.append(document.createTextNode(' to talk.')); }
  else h.appendChild($('em', null, 'The wake word is off. Say Wake now, or hold your dictation key.'));
  p.appendChild(h);
  const q = $('div', 'quick');
  const mk = (label, id, pressed) => { const b = $('button', 'pill', label); if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed)); b.onclick = () => set(id, pressed === undefined ? null : !pressed); return b; };
  const en = find('v.enabled'), mu = find('v.muted');
  if (en) q.appendChild(mk('Listening', 'v.enabled', en.on));
  if (mu) q.appendChild(mk('Mute', 'v.muted', mu.on));
  q.append(mk('Wake now', 'q.wake'), mk('Ask Baton', 'q.ask'), mk('Clear the screen', 'q.clear'), mk('Stop', 'q.stop'));
  p.appendChild(q);
  const up = find('u.act');
  const brainCtl = find('s.brain');
  if (brainCtl && brainCtl.lead) p.appendChild(banner('', 'what Baton works through', 'Choose', 'Claude Code or Codex. You can change it later.', 'Choose', () => go('assistant')));
  else if (up && up.lead) p.appendChild(banner('', 'a quiet moment', 'Baton will restart in', up.hint, null));
  const need = (x.stats && x.stats.needYou) || 0;
  if (need > 0) p.appendChild(banner('warn', 'you', need + (need === 1 ? ' session needs' : ' sessions need'), 'Open Sessions to answer.', 'Open Sessions', () => go('sessions')));
  const sp = $('div', 'split'); const left = $('div'); const right = $('div', 'rail');
  const items = x.activity || [];
  left.appendChild($('div', 'day first', 'Today'));
  if (!items.length) left.appendChild($('div', 'empty', 'Nothing yet. Say a wake word, or hold your dictation key and speak.'));
  let day = null, log = null; if (items.length) { log = $('div', 'log'); left.appendChild(log); day = 'Today'; }
  for (const a of items) {
    const d = dayLabel(a.at); if (d !== day) { day = d; left.appendChild($('div', 'day', d)); log = $('div', 'log'); left.appendChild(log); }
    const li = $('div', 'li' + (a.dim ? ' dim' : '')); li.append($('time', null, clock(a.at)), $('div', 'tx', a.text), $('span', 'tag', a.kind)); log.appendChild(li);
  }
  const st = $('div', 'stats'); const s2 = x.stats || {};
  for (const [n, l] of [[s2.turns || 0, 'turns today'], [s2.dictations || 0, 'dictations today'], [s2.sessions || 0, 'live sessions']]) { const r = $('div', 'stat'); r.append($('b', null, String(n)), $('span', null, l)); st.appendChild(r); }
  right.appendChild($('div', 'day first', 'At a glance')); right.appendChild(st);
  const ins = (S.extra && S.extra.insights) || null;
  if (ins) {
    right.appendChild($('div', 'day', 'Your dictation'));
    const ig = $('div', 'stats');
    const irow = (l, v) => { const r = $('div', 'stat kvr'); r.append($('span', null, l), $('b', 'sm', v)); return r; };
    ig.appendChild(irow('Words today', String(ins.wordsToday)));
    ig.appendChild(irow('Speed', ins.wpm === null ? 'Not enough yet' : ins.wpm + ' words a minute'));
    ig.appendChild(irow('Day streak', ins.streak + (ins.streak === 1 ? ' day' : ' days')));
    for (const a of ins.topApps) ig.appendChild(irow(a.app, a.count + (a.count === 1 ? ' dictation' : ' dictations')));
    right.appendChild(ig);
  }
  const mic = find('v.mic'), vo = find('s.voice'), ou = find('s.output');
  right.appendChild($('div', 'day', 'Your voice'));
  const vc = $('div', 'stats');
  const kv = (l, v) => { const r = $('div', 'stat kvr'); r.append($('span', null, l), $('b', 'sm', v)); return r; };
  vc.appendChild(kv('Wake words', words.length ? words.join(', ') : 'Off'));
  if (mic) vc.appendChild(kv('Microphone', valueOf(mic)));
  if (vo) vc.appendChild(kv('Speaks as', valueOf(vo)));
  if (ou) vc.appendChild(kv('Answers', valueOf(ou)));
  right.appendChild(vc);
  const go2 = $('button', 'btn quiet', 'Change voice settings'); go2.style.marginTop = '12px'; go2.onclick = () => go('voice'); right.appendChild(go2);
  sp.append(left, right); p.appendChild(sp);
}
let vfilter = 'all', forgetAsk = false, editing = null;
function when(iso) { if (!iso) return ''; const d = new Date(iso); return dayLabel(iso) + ', ' + clock(iso); }
function vocabulary(p) {
  const all = (S.extra && S.extra.vocabulary) || [];
  const learned = all.filter(w => w.source === 'learned').length;
  const head = $('div'); head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:30px';
  head.appendChild($('h2', null, 'Vocabulary')); head.firstChild.style.margin = '0';
  const seg = $('div', 'seg');
  for (const [v, l] of [['all', 'All'], ['learned', 'Learned'], ['added', 'Added']]) { const b = $('button', null, l); b.setAttribute('aria-pressed', String(vfilter === v)); b.onclick = () => { vfilter = v; render(); }; seg.appendChild(b); }
  head.appendChild(seg); p.appendChild(head);
  p.appendChild($('p', 'lede', 'Words Baton should spell your way. It adds the ones you correct or use a lot, and you can add your own.')).style.marginTop = '6px';
  const g = $('div', 'group');
  const f = $('form', 'vocab'); const a = $('input'); a.type = 'text'; a.placeholder = 'Heard as'; a.id = 'in-d-a'; a.setAttribute('aria-label', 'Heard as'); a.value = drafts.get('d-a') || '';
  const b = $('input'); b.type = 'text'; b.placeholder = 'Write it as (optional)'; b.id = 'in-d-b'; b.setAttribute('aria-label', 'Write it as'); b.value = drafts.get('d-b') || '';
  a.oninput = () => drafts.set('d-a', a.value); b.oninput = () => drafts.set('d-b', b.value);
  f.onsubmit = e => { e.preventDefault(); const ph = a.value.trim(); if (!ph) return; drafts.delete('d-a'); drafts.delete('d-b'); set('d.add', JSON.stringify({ phrase: ph, replacement: b.value.trim() || null })); };
  f.append(a, b, $('button', 'btn primary', 'Add')); g.appendChild(f);
  const v = all.filter(w => vfilter === 'all' || w.source === vfilter);
  if (!v.length) { const e = $('div', 'row'); e.appendChild($('div', 'hint', all.length ? 'Nothing in this list.' : 'Words you correct or use a lot show up here. You can add your own too.')); g.appendChild(e); }
  for (const w of v) {
    const r = $('div', 'entry');
    if (editing === w.phrase) {
      const e1 = $('input'); e1.type = 'text'; e1.value = w.phrase; e1.setAttribute('aria-label', 'Heard as'); const e2 = $('input'); e2.type = 'text'; e2.value = w.replacement || ''; e2.placeholder = 'Write it as (optional)'; e2.setAttribute('aria-label', 'Write it as');
      const ok = $('button', 'btn primary', 'Save'); ok.onclick = () => { editing = null; set('d.edit', JSON.stringify({ from: w.phrase, phrase: e1.value, replacement: e2.value })); };
      const no = $('button', 'x'); no.appendChild(icon('x', 14)); no.setAttribute('aria-label', 'Cancel'); no.onclick = () => { editing = null; render(); };
      const w2 = $('div', 'pair'); w2.append(ok, no); r.append(e1, $('div', 'arrow', '\u2192'), e2, w2); g.appendChild(r); continue;
    }
    const meta = $('div', 'hint'); meta.append($('span', 'badge ' + w.source, w.source === 'learned' ? 'Learned' : 'Added'));
    if (w.count) meta.append(document.createTextNode(' used ' + w.count + (w.count === 1 ? ' time' : ' times')));
    if (w.lastSeen) meta.append(document.createTextNode(' \u00b7 last ' + when(w.lastSeen)));
    const l = $('div'); l.appendChild($('div', 'label', w.phrase)); l.appendChild(meta);
    const rr = $('div', 'hint', w.replacement === null ? 'same, with its capitals fixed' : w.replacement);
    const ed = $('button', 'btn quiet', 'Edit'); ed.onclick = () => { editing = w.phrase; render(); };
    const x = $('button', 'x'); x.appendChild(icon('x', 14)); x.setAttribute('aria-label', 'Delete ' + w.phrase); x.onclick = () => set('d.remove', w.phrase);
    const w3 = $('div', 'pair'); w3.append(ed, x);
    r.append(l, $('div', 'arrow', '\u2192'), rr, w3); g.appendChild(r);
  }
  p.appendChild(g);
  if (learned) {
    const row = $('div'); row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:12px';
    if (!forgetAsk) { const fb = $('button', 'btn', 'Forget all learned'); fb.onclick = () => { forgetAsk = true; render(); }; row.appendChild(fb); }
    else { row.appendChild($('span', 'hint', 'Forget ' + learned + ' learned ' + (learned === 1 ? 'word' : 'words') + '? Words you added stay.')); const yes = $('button', 'btn primary', 'Forget'); yes.onclick = () => { forgetAsk = false; set('d.forget', null); }; const no = $('button', 'btn', 'Keep them'); no.onclick = () => { forgetAsk = false; render(); }; row.append(yes, no); }
    p.appendChild(row);
  }
}
function keys(p, which) {
  const list = ((S.extra && S.extra.hotkeys) || []).filter(k => !which || which.includes(k.tab));
  if (!list.length) return;
  p.appendChild($('h2', null, 'Keyboard shortcuts'));
  const g = $('div', 'group');
  for (const k of list) { const r = $('div', 'kv'); const t = $('div'); t.appendChild($('div', 'label', k.label)); if (k.hint) t.appendChild($('div', 'hint', k.hint)); const w = $('div'); k.keys.split('+').forEach(x => w.appendChild($('kbd', null, x))); r.append(t, w); g.appendChild(r); }
  const note = $('p', 'hint'); note.style.marginTop = '8px'; note.append(document.createTextNode('Change these in '), (() => { const a = $('button', 'reveal', 'Settings, Keyboard'); a.onclick = () => { modal = 'keys'; render(); }; return a; })(), document.createTextNode('.')); p.appendChild(g); p.appendChild(note); return;
  p.appendChild(g);
}
function resetsIn(iso) { const ms = Date.parse(iso) - Date.now(); if (!(ms > 0)) return 'now'; const h = ms / 3600000; return h < 1 ? 'in under an hour' : h < 48 ? 'in ' + Math.round(h) + ' h' : 'in ' + Math.round(h / 24) + ' d'; }
function usage(p) {
  const rows = (S.extra && S.extra.usage) || [];
  if (!rows.length) { p.appendChild($('div', 'empty', 'No accounts reported yet. They appear here once T3 has loaded your sessions.')); return; }
  const g = $('div', 'group');
  for (const u of rows) {
    const r = $('div', 'row'); r.style.alignItems = 'flex-start'; const t = $('div', 'text'); t.style.flex = '1';
    t.appendChild($('div', 'label', u.account)); t.appendChild($('div', 'hint', 'on ' + u.box));
    for (const w of u.windows) { const l = $('div', 'bar'); l.style.cssText = 'margin-top:10px'; const top = $('div', 'hint', w.label + ' \\u00b7 ' + (w.usedPercent === null ? 'Not applicable' : (100 - Math.round(w.usedPercent)) + '% left') + (w.resetsAt ? ' \\u00b7 resets ' + resetsIn(w.resetsAt) : '')); const tr = $('div'); tr.style.cssText = 'height:6px;border-radius:3px;background:var(--line);margin-top:5px;overflow:hidden'; const f = $('div'); f.style.cssText = 'height:100%;border-radius:3px;background:' + (w.usedPercent >= 90 ? 'var(--bad)' : w.usedPercent >= 70 ? 'var(--warn)' : 'var(--accent)') + ';width:' + Math.max(2, 100 - Math.round(w.usedPercent || 0)) + '%'; tr.appendChild(f); l.append(top); if (w.usedPercent !== null) l.append(tr); t.appendChild(l); }
    r.appendChild(t); g.appendChild(r);
  }
  p.appendChild(g);
}
let hq = '', hrows = null, hopen = new Set(), hask = null, hnote = '', htimer = null, hbusy = new Set(), hlimit = 40, hrec = false;
function loadHistory() {
  const run = real ? ipc.invoke('baton-history:list', hq) : Promise.resolve((window.__BATON_HISTORY__ || []).filter(t => !hq || (t.raw + ' ' + (t.cleaned || '') + ' ' + t.app).toLowerCase().includes(hq.toLowerCase())));
  run.then(r => { hrows = r; render(); });
}
function hact(t, action) {
  if (action === 'delete') { hask = null; }
  if (!real) { if (action === 'delete') { hrows = hrows.filter(x => x.id !== t.id); render(); } else { hnote = 'Copied.'; render(); } return; }
  if (action === 'retry') { hbusy.add(t.id); render(); }
  ipc.invoke('baton-history:act', t.id, action).then(r => {
    hbusy.delete(t.id);
    if (action === 'delete') hrows = hrows.filter(x => x.id !== t.id);
    else if (action === 'retry' && r) { hrows = hrows.map(x => x.id === t.id ? r : x); hopen.add(t.id); hnote = r.status === 'ok' ? 'Cleaned again. Copy it from the row.' : 'Clean-up failed again. The words as heard are still here.'; }
    else if (action.indexOf('copy') === 0) { hnote = 'Copied.'; }
    render();
  });
}
const STATUS = { ok: 'Tidied', raw: 'Inserted as heard', failed: 'Clean-up failed', none: 'Heard' };
function recordings(p) {
  const keep = find('v.keepVoice'), space = find('v.keepSpace');
  const items = ['v.keepVoice', 'v.keepDays', 'v.keepCap', 'v.keepSpace'].map(find).filter(Boolean);
  if (!items.length) return;
  const used = space ? String(space.hint || '').split('.')[0] : '';
  const wrap = $('div', 'recs');
  const head = $('button', 'rechead'); head.setAttribute('aria-expanded', String(hrec));
  head.append($('b', null, 'Recordings'), $('span', 'hint', keep && keep.on ? 'On · ' + used : 'Off · your voice is not saved'), icon('chev', 12));
  head.onclick = () => { hrec = !hrec; render(); }; wrap.appendChild(head);
  if (hrec) wrap.appendChild(group('Voice recordings', items));
  p.appendChild(wrap);
}
function historyPage(p) {
  if (hrows === null) loadHistory();
  const f = $('div', 'hsearch'); const q = $('input'); q.type = 'search'; q.id = 'in-hq'; q.placeholder = 'Search what you said'; q.setAttribute('aria-label', 'Search history'); q.value = hq;
  q.oninput = () => { hq = q.value; hlimit = 40; clearTimeout(htimer); htimer = setTimeout(loadHistory, 180); };
  f.appendChild(q); p.appendChild(f);
  if (hnote) { const n = $('p', 'hint', hnote); n.style.margin = '0 0 10px'; p.appendChild(n); }
  if (hrows === null) { p.appendChild($('div', 'empty', 'Loading.')); recordings(p); return; }
  if (!hrows.length) { p.appendChild($('div', 'empty', hq ? 'Nothing matches.' : 'Nothing yet. Things you say to Baton and dictate show up here.')); recordings(p); return; }
  const shownRows = hrows.slice(0, hlimit);
  const perDay = {}; for (const t of shownRows) { const d = dayLabel(t.at); perDay[d] = (perDay[d] || 0) + 1; }
  let day = null, g = null;
  for (const t of shownRows) {
    const d = dayLabel(t.at); if (d !== day) { day = d; const dh = $('div', 'day'); dh.append(document.createTextNode(d), $('span', 'daycount', ' · ' + perDay[d])); p.appendChild(dh); g = $('div', 'group'); p.appendChild(g); }
    const wrap = $('div', 'hrow'); const line = $('div', 'hline'); const head = $('button', 'hhead'); head.setAttribute('aria-expanded', String(hopen.has(t.id)));
    const text = (t.cleaned || t.raw); head.append($('time', null, clock(t.at)), $('span', 'htext', text.length > 170 ? text.slice(0, 170) + '…' : text), $('span', 'badge ' + (t.status === 'ok' ? 'added' : t.status === 'none' ? 'learned' : 'warnb'), t.kind === 'spoken' ? 'Spoken' : STATUS[t.status] || t.status));
    head.onclick = () => { if (hopen.has(t.id)) hopen.delete(t.id); else hopen.add(t.id); render(); };
    const cp = $('button', 'hcopy', 'Copy'); cp.setAttribute('aria-label', 'Copy this transcript'); cp.onclick = () => hact(t, t.cleaned ? 'copy_cleaned' : 'copy_raw');
    line.append(head, cp); wrap.appendChild(line);
    if (hopen.has(t.id)) {
      const body = $('div', 'hbody');
      const blk = (l, x) => { const b = $('div', 'hblock'); b.append($('div', 'hint', l), $('div', 'hpre', x)); return b; };
      body.appendChild(blk('As heard', t.raw)); if (t.cleaned) body.appendChild(blk('Written', t.cleaned));
      const meta = [t.app && ('in ' + t.app), t.delivery && ('delivered: ' + t.delivery), t.model && ('tidied by ' + t.model), t.audio ? 'recording kept' : null, t.corrected ? 'you corrected it' : null, t.error].filter(Boolean).join(' · ');
      if (meta) body.appendChild($('div', 'hint', meta));
      const acts = $('div', 'hacts');
      const mk = (l, fn, cls) => { const b = $('button', 'btn ' + (cls || 'quiet'), l); b.onclick = fn; return b; };
      acts.appendChild(mk('Copy as heard', () => hact(t, 'copy_raw')));
      if (t.cleaned) acts.appendChild(mk('Copy written', () => hact(t, 'copy_cleaned')));
      if (t.kind === 'dictation' && (t.status === 'raw' || t.status === 'failed')) acts.appendChild(mk(hbusy.has(t.id) ? 'Cleaning' : 'Retry clean-up', () => hact(t, 'retry'), 'primary'));
      if (hask === t.id) { acts.append($('span', 'hint', 'Delete this for good?'), mk('Delete', () => hact(t, 'delete'), 'primary'), mk('Keep', () => { hask = null; render(); })); }
      else acts.appendChild(mk('Delete', () => { hask = t.id; render(); }));
      body.appendChild(acts); wrap.appendChild(body);
    }
    g.appendChild(wrap);
  }
  if (hrows.length > hlimit) { const more = $('button', 'btn quiet', 'Show older (' + (hrows.length - hlimit) + ')'); more.style.marginTop = '12px'; more.onclick = () => { hlimit += 40; render(); }; p.appendChild(more); }
  recordings(p);
}
function tabPage(p) {
  if (cur === 'home') return home(p);
  const intro = INTRO[cur]; p.appendChild(pageHead(intro[0], intro[1]));
  if (cur === 'usage') return usage(p);
  if (cur === 'history') return historyPage(p);
  const items = tabControls(cur);
  if (cur === 'sessions' && !items.length) p.appendChild($('div', 'empty', 'No sessions yet. Start one in Claude Code or T3 and it appears here.'));
  for (const s of sections(items)) { if (sections(items).length > 1 || s.name !== intro[0]) p.appendChild($('h2', null, s.name)); p.appendChild(group(s.name, s.items)); }
  if (cur === 'dictation') { vocabulary(p); keys(p, ['dictation']); }
  if (cur === 'voice') keys(p, ['voice']);
  if (cur === 'screen') {
    p.insertBefore($('h2', null, 'Actions'), p.firstChild.nextSibling.nextSibling);
    const ag = $('div', 'group');
    for (const [l, h, b, id] of [['Ask Baton', 'Type a question about your screen or a job to do.', 'Ask', 'q.ask'], ['Clear the screen', 'Remove the pointer and any card Baton left up.', 'Clear', 'q.clear'], ['Stop', 'End a lesson or a drive, and quiet Baton\u2019s voice.', 'Stop', 'q.stop']]) { const r = $('div', 'row'); const t = $('div', 'text'); t.append($('div', 'label', l), $('div', 'hint', h)); const bt = $('button', 'btn', b); bt.onclick = () => set(id, null); r.append(t, bt); ag.appendChild(r); }
    p.insertBefore(ag, p.firstChild.nextSibling.nextSibling.nextSibling);
    p.appendChild($('h2', null, 'What Baton can do with your screen'));
    const hg = $('div', 'group');
    for (const [l, h] of [['Look', 'Ask what is on your screen. Baton takes one screenshot of each display and answers.'], ['Teach', 'Ask how to do something. Baton shows each step on your screen, one at a time.'], ['Drive', 'Ask Baton to do it. It moves the pointer, you can take over, and Escape stops it.']]) { const r = $('div', 'kv'); const t = $('div'); t.append($('div', 'label', l), $('div', 'hint', h)); r.appendChild(t); hg.appendChild(r); }
    p.appendChild(hg);
    keys(p, ['screen']);
  }
  if (cur === 'checks') { if (!items.some(c => c.kind === 'check')) { const e = $('div', 'empty', 'Nothing has run yet. Press Run checks.'); e.style.marginTop = '16px'; p.appendChild(e); } const x = S.extra || {}; if ((x.lifecycle || []).length) { p.appendChild($('h2', null, 'Why Baton last went down')); const g = $('div', 'group'); for (const l of x.lifecycle) { const r = $('div', 'kv'); r.append($('div', null, l.text), $('time', 'hint', clock(l.at))); g.appendChild(r); } p.appendChild(g); } }
}

const MODAL = [['General', 'general'], ['System', 'system'], ['Keyboard and mouse', 'keys'], ['Account', 'account'], ['Updates', 'updates'], ['About', 'about']];
let capturing = null, capNote = '';
function keyName(e) { const k = e.key; if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'Dead', 'Unidentified'].includes(k)) return null; const m = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Escape: 'Escape' }; return m[k] || (k.length === 1 ? k.toUpperCase() : k); }
function accel(e) { const k = keyName(e); if (!k) return null; const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean); return mods.concat([k]).join('+'); }
function chips(input) { const w = $('div', 'chips'); if (!input) { w.appendChild($('span', 'hint', 'Off')); return w; } if (input.type === 'key') input.accelerator.split('+').forEach(x => w.appendChild($('kbd', null, x))); else w.appendChild($('span', 'chip plain', ({ middle: 'Middle button', back: 'Back button', forward: 'Forward button', 'left+right': 'Left and right together' })[input.button] || input.button)); return w; }
function bindingsPage(b) {
  const x = S.extra || {}; const rows = x.bindings || [];
  b.appendChild($('h1', null, 'Keyboard and mouse'));
  const lead = $('p', 'lede', 'Choose how to start, stop and steer Baton by hand. Voice always works with no button at all.'); b.appendChild(lead);
  const g = $('div', 'group');
  for (const r of rows) {
    const wrap = $('div', 'rowwrap'); const row = $('div', 'row'); const t = $('div', 'text'); t.append($('div', 'label', r.label), $('div', 'hint', r.hint));
    if (r.input && r.input.type === 'mouse' && !x.mouseReady) t.appendChild($('div', 'hint', 'Saved. Mouse buttons start working with Baton\u2019s input helper.'));
    if (r.conflictsWith.length) { const c = $('div', 'fix', 'Same as ' + r.conflictsWith.join(' and ') + '. Only one of them will work.'); c.style.color = 'var(--warn)'; t.appendChild(c); }
    const side = $('div'); side.style.cssText = 'display:flex;align-items:center;gap:10px;flex:none';
    const on = capturing === r.action;
    side.appendChild(chips(r.input));
    const ch = $('button', 'btn quiet', on ? 'Cancel' : 'Change'); ch.onclick = () => { capturing = on ? null : r.action; capNote = ''; render(); }; side.appendChild(ch);
    if (r.input && !on) { const cl = $('button', 'btn quiet', 'Clear'); cl.onclick = () => set('b.clear:' + r.action, null); side.appendChild(cl); }
    if (!r.isDefault && !on) { const rs = $('button', 'btn quiet', 'Reset'); rs.onclick = () => set('b.reset:' + r.action, null); side.appendChild(rs); }
    row.append(t, side); wrap.appendChild(row);
    if (on) { const cap = $('div', 'inline capture'); cap.appendChild($('div', 'label', 'Press a key or a chord, or click a mouse button. Escape cancels.')); if (capNote) cap.appendChild($('div', 'hint', capNote)); wrap.appendChild(cap); }
    g.appendChild(wrap);
  }
  const f = $('div', 'row'); const ft = $('div', 'text'); ft.append($('div', 'label', 'Cancel a recording, a card or a drive'), $('div', 'hint', 'Always Escape.')); f.append(ft, chips({ type: 'key', accelerator: 'Escape' })); g.appendChild(f);
  b.appendChild(g);
  const reset = $('button', 'btn quiet', 'Reset all to defaults'); reset.style.marginTop = '14px'; reset.onclick = () => set('b.resetAll:all', null); b.appendChild(reset);
  const n = $('p', 'hint', 'A button you do not set here passes through to your apps unchanged. Keys that another app already uses may not register.'); n.style.marginTop = '12px'; b.appendChild(n);
}
addEventListener('keydown', e => {
  if (!capturing) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { capturing = null; capNote = ''; render(); return; }
  const a = accel(e); if (!a) return;
  const bare = !/\\+/.test(a);
  if (bare && !/^F\d+$/.test(a)) { capNote = 'Add Ctrl, Alt or Shift so it does not get in the way of typing.'; render(); return; }
  const id = capturing; capturing = null; capNote = ''; set('b.set:' + id, JSON.stringify({ type: 'key', accelerator: a }));
}, true);
addEventListener('mousedown', e => {
  if (!capturing) return;
  let button = null;
  if (e.buttons === 3) button = 'left+right'; else if (e.button === 1) button = 'middle'; else if (e.button === 3) button = 'back'; else if (e.button === 4) button = 'forward';
  if (!button) return;
  e.preventDefault(); const id = capturing; capturing = null; capNote = ''; set('b.set:' + id, JSON.stringify({ type: 'mouse', button }));
}, true);
function modalPage(b) {
  const x = S.extra || {};
  const rows = ids => S.controls.filter(c => ids.includes(c.id));
  if (modal === 'general') { b.appendChild($('h1', null, 'General')); const g = $('div', 'group'); const items = rows(['v.login']); for (const c of items) g.appendChild(row(c)); const q = $('div', 'row'); const t = $('div', 'text'); t.append($('div', 'label', 'Quit Baton'), $('div', 'hint', 'Closing the window keeps Baton in the tray. Quit ends it.')); const qb = $('button', 'btn', 'Quit'); qb.onclick = () => set('q.quit', null); q.append(t, qb); g.appendChild(q); b.appendChild(g); }
  else if (modal === 'system') { b.appendChild($('h1', null, 'System')); const g = $('div', 'group'); for (const c of rows(['v.file'])) g.appendChild(row(c)); for (const p of (x.paths || [])) { const r = $('div', 'kv'); const t = $('div'); t.append($('div', 'label', p.label), $('div', 'hint', p.path)); const ob = $('button', 'btn', 'Open'); ob.onclick = () => set('q.open:' + p.id, null); r.append(t, ob); g.appendChild(r); } b.appendChild(g); }
  else if (modal === 'keys') bindingsPage(b);
  else if (modal === 'account') { b.appendChild($('h1', null, 'Account')); const g = $('div', 'group'); for (const c of rows(['s.account', 's.accountEmail'])) g.appendChild(row(c)); b.appendChild(g); const n = $('p', 'hint', 'Baton uses your own subscription through the claude and codex programs. It never uses an API key.'); n.style.marginTop = '12px'; b.appendChild(n); }
  else if (modal === 'updates') { b.appendChild($('h1', null, 'Updates')); const g = $('div', 'group'); for (const c of rows(['u.act'])) g.appendChild(row(c)); const ab = x.about || {}; for (const [l, v] of [['Installed version', ab.version], ['Updates come from', ab.source]]) { if (!v) continue; const r = $('div', 'kv'); r.append($('div', 'label', l), $('div', 'hint', v)); g.appendChild(r); } b.appendChild(g); b.appendChild($('p', 'hint', 'Baton downloads an update in the background and tells you before it restarts.')).style.marginTop = '12px'; }
  else { b.appendChild($('h1', null, 'About')); const a = x.about || {}; const g = $('div', 'group'); for (const [l, v] of [['Version', a.version], ['Installed from', a.source], ['Licence', a.licence], ['Third-party notices', a.notices]]) { if (!v) continue; const r = $('div', 'kv'); r.append($('div', 'label', l), $('div', 'hint', v)); g.appendChild(r); } b.appendChild(g); }
}
function modalEl() {
  const veil = $('div', null); veil.id = 'veil'; veil.className = modal ? 'on' : ''; veil.onclick = e => { if (e.target === veil) closeModal(); };
  if (!modal) return veil;
  const m = $('div'); m.id = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Settings');
  const nav = $('div'); nav.id = 'mnav'; nav.appendChild($('h4', null, 'Settings'));
  for (const [l, id] of MODAL) { if (id === 'account') nav.appendChild($('h4', null, 'Account')); const b = $('button', 'nav', l); if (modal === id) b.setAttribute('aria-current', 'page'); b.onclick = () => { modal = id; render(); }; nav.appendChild(b); }
  nav.appendChild($('div', 'ver', 'Baton ' + (((S.extra || {}).about || {}).version || '')));
  const body = $('div'); body.id = 'mbody'; const cl = $('button', 'ibtn'); cl.id = 'mclose'; cl.setAttribute('aria-label', 'Close'); cl.appendChild(icon('x')); cl.onclick = closeModal; body.appendChild(cl); modalPage(body);
  m.append(nav, body); veil.appendChild(m); return veil;
}
function closeModal() { modal = null; render(); }
function go(t) { cur = t; render(); document.getElementById('panel').scrollTop = 0; }

function render(state) {
  if (state) S = state;
  const keep = document.activeElement && document.activeElement.id, pos = document.activeElement && document.activeElement.selectionStart;
  const app = document.getElementById('app'); app.className = collapsed ? 'collapsed' : '';
  const side = document.getElementById('side'); side.replaceChildren();
  const brand = $('div', 'brand'); const mk = $('span'); mk.id = 'mark'; mk.innerHTML = S.status.brandMark || S.status.mark; brand.append(mk, $('b', null, 'Baton'), $('span', 'plan', 'Local')); side.appendChild(brand);
  const nav = $('nav'); const need = (S.extra && S.extra.stats && S.extra.stats.needYou) || 0;
  for (const [id, label] of TABS) { const b = $('button', 'nav'); if (cur === id) b.setAttribute('aria-current', 'page'); b.append(icon(id), $('span', null, label)); if (id === 'sessions' && need) b.appendChild($('span', 'n', String(need))); b.onclick = () => go(id); nav.appendChild(b); }
  side.appendChild(nav); side.appendChild($('div', 'spacer'));
  const up = find('u.act');
  if (up && up.lead) { const c = $('div', 'sidecard go'); c.append($('b', null, 'Update ready'), $('p', null, 'Baton restarts itself and reopens this window.')); const bt = $('button', 'btn', up.button); bt.onclick = () => set('u.act', null); c.appendChild(bt); side.appendChild(c); }
  const foot = $('div', 'foot'); const st = $('button', 'nav'); st.append(icon('settings'), $('span', null, 'Settings')); st.onclick = () => { modal = 'general'; render(); };
  const t3 = $('button', 'nav'); t3.append(icon('external'), $('span', null, 'Open T3 sessions')); t3.onclick = () => real && ipc.send('baton-home:sessions');
  foot.append(t3, st); side.appendChild(foot);
  const top = document.getElementById('top'); top.replaceChildren();
  const tg = $('button', 'ibtn'); tg.setAttribute('aria-label', 'Show or hide the sidebar'); tg.appendChild(icon('side')); tg.onclick = () => { collapsed = !collapsed; render(); }; top.appendChild(tg);
  const stt = $('div', 'state'); const d = $('span', 'dot'); d.setAttribute('data-tone', S.status.tone); stt.append(d, $('span', null, S.status.label + (S.status.device ? ' \\u00b7 ' + S.status.device : ''))); top.appendChild(stt);
  const bell = $('button', 'ibtn'); bell.setAttribute('aria-label', 'Alerts'); bell.appendChild(icon('bell')); if ((up && up.lead) || need) bell.appendChild($('span', 'pip')); bell.onclick = () => go(need ? 'sessions' : 'home'); top.appendChild(bell);
  const ac = $('button', 'ibtn'); ac.setAttribute('aria-label', 'Account'); ac.appendChild(icon('user')); ac.onclick = () => { modal = 'account'; render(); }; top.appendChild(ac);
  const page = document.getElementById('page'); page.replaceChildren(); page.className = cur === 'home' ? 'wide' : ''; tabPage(page);
  const old = document.getElementById('veil'); if (old) old.remove(); document.body.appendChild(modalEl());
  if (keep && keep.indexOf('in-') === 0) { const e = document.getElementById(keep); if (e) { e.focus(); if (pos != null) e.setSelectionRange(pos, pos); } }
}
addEventListener('keydown', e => { if (e.key === 'Escape' && modal) closeModal(); });
if (real) ipc.on('baton-home:state', (_e, s) => render(s));
get().then(s => render(s));
`;
