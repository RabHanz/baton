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
  snippets: '<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h5"/>',
  now: '<circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  sessions: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="18" height="5" rx="1.5"/><path d="M7 20h10"/>',
  approvals: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  jobs: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  dictation: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  assistant: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>',
  voice: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  usage: '<path d="M4 19V9M10 19V5M16 19v-8M22 19H2"/>',
  tools: '<path d="M14 6l4 4-8 8H6v-4z"/><path d="M13 7l4 4"/>',
  memory: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h8"/>',
  vault: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
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
const TABS = [['home','Home'],['now','Now'],['snippets','Snippets'],['sessions','Sessions'],['approvals','Approvals'],['jobs','Jobs'],['dictation','Dictation'],['history','History'],['memory','Memory'],['vault','Vault'],['tools','Skills'],['assistant','Assistant'],['voice','Voice'],['screen','Screen'],['usage','Usage'],['checks','Checks']];
const INTRO = {
  snippets: ['Snippets', 'Say a short cue and the full text lands in the field: an email address, a link, a prompt you reuse.'],
  now: ['Now', 'What needs you, what Tessaya is keeping track of and doing, what it learned today, and what it held back and why.'],
  sessions: ['Sessions', 'Every live session on every connected machine. Open one, or type to it.'],
  approvals: ['Approvals', 'Everything waiting for your yes, with what it would do and what it would use. High-risk actions still ask you aloud when they happen.'],
  jobs: ['Jobs', 'Long work Tessaya handed to a worker. It plans first and starts only when you approve.'],
  dictation: ['Dictation', 'Talk into any app. Your words stay on this computer.'],
  tools: ['Skills and tools', 'The plugins, skills and servers that Claude Code and Codex already have. Tessaya adds none of its own. A plugin switch changes Claude Code\u2019s own setting and applies to its next session.'],
  memory: ['Memory', 'What Tessaya remembers about you and your work, and what it learned. Search it, correct it, pin what must never fade, or forget it. Forgetting a memory never touches Tessaya itself.'],
  vault: ['Vault', 'Passwords, keys and private notes, encrypted on this computer. Tessaya can use a secret for you without ever seeing it, and every use is logged here. Banking passwords you always type yourself.'],
  history: ['History', 'Everything you said and what it became. Kept on this computer, forever, until you delete it.'],
  assistant: ['Assistant', 'What Tessaya works through, whose subscription it uses, and what it may do without asking.'],
  voice: ['Voice', 'How Tessaya hears you and how it sounds back.'],
  screen: ['Screen', 'When Tessaya may look at your screen, and how to stop it.'],
  usage: ['Usage', 'How much of each account is left.'],
  checks: ['Checks', 'See what is wrong without reading a log.']
};
let cur = 'home', collapsed = false, modal = null, S = null, query = '';
let aboutSeen = false;
const open = new Set(), shown = new Set(), drafts = new Map(), changing = new Set();

function control(c) {
  if (c.kind === 'toggle') { const b = $('button', 'sw'); b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(c.on)); b.setAttribute('aria-label', c.label); b.onclick = () => set(c.id, !c.on); return b; }
  if (c.kind === 'choice') {
    if (c.id === 's.voice') {
      const list = $('div', 'voices');
      for (const o of c.options) {
        const r = $('div', 'voice' + (o.value === c.value ? ' on' : ''));
        const pick = $('button', 'pickv', o.label); pick.setAttribute('role', 'radio'); pick.setAttribute('aria-checked', String(o.value === c.value)); pick.onclick = () => set(c.id, o.value);
        r.appendChild(pick);
        if (o.value !== 'system') { const pl = $('button', 'btn quiet', 'Play'); pl.setAttribute('aria-label', 'Play ' + o.label); pl.onclick = () => set('v.audition', o.value); r.appendChild(pl); }
        list.appendChild(r);
      }
      return list;
    }
    if (c.options.length <= 4 && c.options.reduce((n, o) => n + o.label.length, 0) <= 40) {
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
  t.appendChild($('div', 'hint', 'Say any of these to wake Tessaya. Turn off the ones you do not want.'));
  r.append(t); wrap.appendChild(r);
  { const i = $('div', 'inline wakes'); for (const x of items) { const l = $('label', 'wk'); l.append($('span', null, x.label.replace(/^Wake word: /, '')), control(x)); i.appendChild(l); } wrap.appendChild(i); }
  return wrap;
}
const memEditing = new Set();
function memoryRow(c) {
  const id = c.id.slice(2), wrap = $('div', 'rowwrap'), r = $('div', 'row'), t = $('div', 'text');
  if (memEditing.has(c.id)) {
    const a = $('textarea', 'memedit'); a.id = 'in-e-' + c.id; a.maxLength = 500; a.setAttribute('aria-label', 'Edit this memory'); a.value = drafts.has('e-' + c.id) ? drafts.get('e-' + c.id) : c.label; a.oninput = () => drafts.set('e-' + c.id, a.value);
    const done = () => { memEditing.delete(c.id); drafts.delete('e-' + c.id); };
    const save = $('button', 'btn primary', 'Save'); save.onclick = () => { const v = a.value.trim(); done(); if (v) set('m.edit:' + id, v); else render(); };
    const cancel = $('button', 'btn quiet', 'Cancel'); cancel.onclick = () => { done(); render(); };
    const acts = $('div', 'memacts'); acts.append(save, cancel); t.append(a, acts); r.appendChild(t); wrap.appendChild(r); return wrap;
  }
  t.appendChild($('div', 'label', c.label)); if (c.hint) t.appendChild($('div', 'hint', c.hint)); r.appendChild(t);
  const acts = $('div', 'memacts');
  if (c.held) { const keep = $('button', 'btn primary', 'Keep'); keep.onclick = () => set('m.accept:' + id, null); acts.appendChild(keep); }
  else if (c.section !== 'Replaced') {
    const pin = $('button', 'btn quiet', c.pinned ? 'Unpin' : 'Pin'); pin.setAttribute('aria-pressed', String(c.pinned)); pin.onclick = () => set('m.pin:' + id, !c.pinned);
    const ed = $('button', 'btn quiet', 'Edit'); ed.onclick = () => { memEditing.add(c.id); render(); }; acts.append(pin, ed);
  }
  const fg = $('button', 'btn quiet', c.held ? 'Dismiss' : 'Forget'); fg.onclick = () => set('m.forget:' + id, null); acts.appendChild(fg);
  r.appendChild(acts); wrap.appendChild(r); return wrap;
}
function memoryBar(c) {
  const w = $('div', 'rowwrap stack membar'), f = $('form', 'vocab'), q = $('input'); q.type = 'text'; q.id = 'in-m-q'; q.placeholder = 'Search what Tessaya remembers'; q.setAttribute('aria-label', 'Search memory'); q.value = drafts.has('m-q') ? drafts.get('m-q') : c.query;
  let tm = null; q.oninput = () => { drafts.set('m-q', q.value); clearTimeout(tm); tm = setTimeout(() => set('m.query', q.value), 250); };
  f.onsubmit = e => { e.preventDefault(); clearTimeout(tm); set('m.query', q.value); }; f.appendChild(q); w.appendChild(f);
  const seg = $('div', 'seg memseg'); for (const k of c.kinds) { const b = $('button', null, k.label + ' ' + k.count); b.setAttribute('aria-pressed', String(k.value === c.filter)); b.onclick = () => set('m.kind', k.value); seg.appendChild(b); } w.appendChild(seg);
  const tools = $('div', 'memtools');
  if (c.usedCount) { const u = $('button', 'btn quiet', 'Used in the last answer (' + c.usedCount + ')'); u.setAttribute('aria-pressed', String(c.usedOnly)); u.onclick = () => set('m.used', !c.usedOnly); tools.appendChild(u); }
  const ex = $('button', 'btn quiet', 'Export'); ex.onclick = () => set('m.export', null); tools.appendChild(ex); w.appendChild(tools);
  const imp = $('form', 'vocab'), fi = $('input'); fi.type = 'text'; fi.id = 'in-m-imp'; fi.placeholder = 'Import a folder of .md learnings: its full path'; fi.setAttribute('aria-label', 'Folder to import'); fi.value = drafts.get('m-imp') || ''; fi.oninput = () => drafts.set('m-imp', fi.value);
  const ib = $('button', 'btn quiet', 'Import'); ib.type = 'submit'; imp.append(fi, ib); imp.onsubmit = e => { e.preventDefault(); const v = fi.value.trim(); if (!v) return; drafts.delete('m-imp'); set('m.import', v); }; w.appendChild(imp);
  const sy = $('div', 'row'), st = $('div', 'text'); st.append($('div', 'label', 'Keep servers in step'), $('div', 'hint', 'Memory is carried between the servers this window is connected to. The last change wins, and a forgotten memory stays forgotten.'));
  const sw = $('button', 'sw'); sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', String(c.syncOn)); sw.setAttribute('aria-label', 'Keep servers in step'); sw.onclick = () => set('m.syncOn', !c.syncOn); sy.append(st, sw);
  if (c.syncOn) { const nb = $('button', 'btn quiet', 'Sync now'); nb.onclick = () => set('m.sync', null); sy.appendChild(nb); } w.appendChild(sy);
  const pl = $('div', 'row'), pt = $('div', 'text'); pt.append($('div', 'label', 'Pull learnings from the history index'), $('div', 'hint', 'Once a day, short quotes about what worked and failed in your ventures are proposed here. They wait for your yes; nothing is copied from a session.'));
  const ps = $('button', 'sw'); ps.setAttribute('role', 'switch'); ps.setAttribute('aria-checked', String(c.pullOn)); ps.setAttribute('aria-label', 'Pull learnings'); ps.onclick = () => set('m.pullOn', !c.pullOn); pl.append(pt, ps);
  if (c.pullOn) { const pb = $('button', 'btn quiet', 'Pull now'); pb.onclick = () => set('m.pull', null); pl.appendChild(pb); } w.appendChild(pl);
  if (c.status) { const x = $('div', 'hint memstatus', c.status); x.setAttribute('role', 'status'); w.appendChild(x); }
  return w;
}
function listRow(c) {
  const w = $('div', 'rowwrap stack'); const t = $('div', 'row'); const x = $('div', 'text'); x.appendChild($('div', 'label', c.label)); if (c.hint) x.appendChild($('div', 'hint', c.hint)); t.appendChild(x); w.appendChild(t);
  for (const it of c.items) { const r = $('div', 'row'); r.appendChild($('div', 'label', it)); const b = $('button', 'btn quiet', 'Remove'); b.setAttribute('aria-label', 'Remove ' + it); b.onclick = () => set(c.id + ':rm', it); r.appendChild(b); w.appendChild(r); }
  const add = $('div', 'row'); const inp = $('input', 'search'); inp.type = 'text'; inp.placeholder = c.placeholder; inp.setAttribute('aria-label', c.label);
  const ab = $('button', 'btn', c.addLabel || 'Add'); const go = () => { const v = inp.value.trim(); if (v) set(c.id + ':add', v); };
  ab.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); }; add.append(inp, ab); w.appendChild(add); return w;
}
function vtInput(id, ph, type) { const i = $('input'); i.type = type || 'text'; i.id = 'in-' + id; i.placeholder = ph; i.setAttribute('aria-label', ph); i.autocomplete = 'off'; i.value = drafts.get(id) || ''; i.oninput = () => drafts.set(id, i.value); return i; }
function vtForm(fields, button, run) { const f = $('form', 'vocab'); f.append(...fields); const b = $('button', 'btn' + (button.primary ? ' primary' : ' quiet'), button.label); b.type = 'submit'; f.appendChild(b); f.onsubmit = e => { e.preventDefault(); run(); }; return f; }
function vaultBar(c) {
  const w = $('div', 'rowwrap stack vaultbar');
  if (c.recovery) {
    const k = $('div', 'row'); const t = $('div', 'text'); t.append($('div', 'label', 'Your recovery key'), $('div', 'hint', 'Print it or save it somewhere safe. It is shown once and is the only way in if you forget the passphrase.')); const pre = $('div', 'hpre vaultkey', c.recovery); t.appendChild(pre);
    const ok = $('button', 'btn primary', 'I have saved it'); ok.onclick = () => set('vt.recoveryDone', null); k.append(t, ok); w.appendChild(k);
  }
  if (c.state === 'none') {
    w.appendChild(vtForm([vtInput('vt-new', 'Choose a passphrase (8 or more characters)', 'password')], { label: 'Make the vault', primary: true }, () => { const v = drafts.get('vt-new') || ''; drafts.delete('vt-new'); set('vt.create', v); }));
  } else if (c.state === 'locked') {
    w.appendChild(vtForm([vtInput('vt-pass', 'Passphrase', 'password')], { label: 'Unlock', primary: true }, () => { const v = drafts.get('vt-pass') || ''; drafts.delete('vt-pass'); set('vt.unlock', v); }));
    const alt = $('div', 'memtools');
    const hb = $('button', 'btn quiet', 'Unlock with Windows Hello'); hb.onclick = () => set('vt.unlockHello', null); alt.appendChild(hb); w.appendChild(alt);
    w.appendChild(vtForm([vtInput('vt-rec', 'Or a recovery key', 'password')], { label: 'Use recovery key' }, () => { const v = drafts.get('vt-rec') || ''; drafts.delete('vt-rec'); set('vt.unlockRecovery', v); }));
  } else {
    const cat = $('select'); cat.id = 'in-vt-cat'; cat.setAttribute('aria-label', 'What kind'); for (const k of ['login', 'key', 'note', 'id', 'file', 'financial']) { const o = $('option', null, k); o.value = k; cat.appendChild(o); }
    const nm = vtInput('vt-name', 'Name, like github'), lb = vtInput('vt-label', 'A note to yourself (optional)'), vl = vtInput('vt-value', 'The secret', 'password');
    w.appendChild(vtForm([nm, lb, cat, vl], { label: 'Add', primary: true }, () => { const v = { name: nm.value.trim(), label: lb.value, category: cat.value, value: vl.value }; ['vt-name', 'vt-label', 'vt-value'].forEach(d => drafts.delete(d)); set('vt.add', JSON.stringify(v)); }));
    w.appendChild($('div', 'hint memstatus', 'Passwords of banks and cards can be kept here, but Tessaya will never fill them in: you type those yourself.'));
  }
  if (c.status) { const x = $('div', 'hint memstatus', c.status); x.setAttribute('role', 'status'); w.appendChild(x); }
  if (c.state === 'unlocked') {
    const tools = $('div', 'memtools'); const lk = $('button', 'btn', 'Lock now'); lk.onclick = () => set('vt.lock', null); tools.appendChild(lk); w.appendChild(tools);
    w.appendChild(vtForm([vtInput('vt-exp', 'Export passphrase', 'password')], { label: 'Export encrypted file' }, () => { const v = drafts.get('vt-exp') || ''; drafts.delete('vt-exp'); set('vt.export', v); }));
    const ip = vtInput('vt-imp', 'Path of an exported file'), iw = vtInput('vt-imppw', 'Its passphrase', 'password');
    w.appendChild(vtForm([ip, iw], { label: 'Import' }, () => { const v = { path: ip.value.trim(), passphrase: iw.value }; drafts.delete('vt-imp'); drafts.delete('vt-imppw'); set('vt.import', JSON.stringify(v)); }));
  }
  if ((c.activity || []).length) {
    w.appendChild($('h3', 'vaulthead', 'Activity'));
    for (const line of c.activity) { let e = null; try { e = JSON.parse(line); } catch (x) { e = null; } if (!e) continue; const r = $('div', 'kv'); r.append($('div', null, e.name + ' \u00b7 ' + e.outcome + ' \u00b7 ' + (e.target || '') + (e.purpose ? ' \u00b7 ' + e.purpose : '')), $('time', 'hint', clock(e.at))); w.appendChild(r); }
  }
  return w;
}
function vaultItem(c) {
  const wrap = $('div', 'rowwrap'), r = $('div', 'row'), t = $('div', 'text'); t.append($('div', 'label', c.label), $('div', 'hint', c.hint));
  if (c.revealed !== null) { const v = $('div', 'hpre vaultkey', c.revealed); v.setAttribute('role', 'status'); t.appendChild(v); }
  r.appendChild(t); const acts = $('div', 'memacts'), id = c.id.slice(3);
  const rv = $('button', 'btn quiet', 'Reveal'); rv.onclick = () => set('vt.reveal:' + id, null);
  const cp = $('button', 'btn quiet', 'Copy'); cp.onclick = () => set('vt.copy:' + id, null);
  acts.append(rv, cp);
  if (!c.locked) { const sel = $('select'); sel.setAttribute('aria-label', 'Who may use ' + c.label); for (const [v, l] of [['ask', 'Ask me each time'], ['domain:10', 'Allow a site for 10 minutes'], ['never', 'Only me']]) { const o = $('option', null, l); o.value = v; o.selected = v === c.policy; sel.appendChild(o); } sel.onchange = () => set('vt.policy:' + id, sel.value); acts.appendChild(sel); }
  const dl = $('button', 'btn quiet', 'Delete'); dl.onclick = () => set('vt.delete:' + id, null); acts.appendChild(dl);
  r.appendChild(acts); wrap.appendChild(r); return wrap;
}
function row(c) {
  if (c.kind === 'vaultBar') return vaultBar(c);
  if (c.kind === 'vaultItem') return vaultItem(c);
  if (c.kind === 'list') return listRow(c);
  if (c.kind === 'memory') return memoryRow(c);
  if (c.kind === 'memoryBar') return memoryBar(c);
  // A choice shows its options where it is: a few short ones as buttons, more as a menu, a list with notes below its label.
  if (c.kind === 'choice' && (c.id === 's.voice' || c.options.some(o => o.note))) { const w = $('div', 'rowwrap stack'); const t = $('div', 'row'); const x = $('div', 'text'); x.appendChild($('div', 'label', c.label)); if (c.hint) x.appendChild($('div', 'hint', c.hint)); t.appendChild(x); w.append(t, control(c)); return w; }
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
    const names = more.filter(x => x.kind !== 'check' || more.length < 3).map(x => x.label.replace(/^Wake word: /, '').toLowerCase()), held = names.slice(0, 3).join(', ') + (names.length > 3 ? ' and more' : '');
    const ml = (more.find(x => x.moreLabel) || {}).moreLabel || ('Advanced: ' + held), fl = ml === 'Show all' ? 'Show fewer' : 'Hide advanced';
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

// The wake sting plays once when the window opens and when About opens, on every mark that is up, then each rests on its still.
let stingUntil = 0;
function startSting() {
  if (!window.TESSAYA_STING || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  stingUntil = Date.now() + 2100; render(); setTimeout(render, 2150);
}
function markHtml() {
  if (Date.now() < stingUntil && window.TESSAYA_STING) { const dark = document.documentElement.dataset.theme === 'dark'; return '<img alt="" style="width:100%;height:100%;display:block" src="data:image/webp;base64,' + (dark ? TESSAYA_STING.dark : TESSAYA_STING.light) + '">'; }
  return S.status.brandMark || S.status.mark;
}
function home(p) {
  const x = S.extra || {}; const words = x.wakeWords || [];
  const hm = $('span', 'homemark'); hm.innerHTML = S.status.brandMark || ''; p.appendChild(hm);
  p.appendChild($('div', 'dateline', new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })));
  const h = $('h1'); h.append(document.createTextNode(greeting() + '.')); p.appendChild(h);
  const sub = $('p', 'lede');
  if (words.length) { sub.append(document.createTextNode('Say ')); words.slice(0, 2).forEach((w, i) => { if (i) sub.append(document.createTextNode(' or ')); sub.appendChild($('em', null, w)); }); sub.append(document.createTextNode(' to talk.')); }
  else sub.textContent = 'The wake word is off. Say Wake now, or hold your dictation key.';
  p.appendChild(sub);
  const q = $('div', 'quick');
  const mk = (label, id, pressed) => { const b = $('button', 'pill', label); if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed)); b.onclick = () => set(id, pressed === undefined ? null : !pressed); return b; };
  const en = find('v.enabled'), mu = find('v.muted');
  if (en) q.appendChild(mk('Listening', 'v.enabled', en.on));
  if (mu) q.appendChild(mk('Mute', 'v.muted', mu.on));
  q.append(mk('Wake now', 'q.wake'), mk('Ask Tessaya', 'q.ask'), mk('Clear the screen', 'q.clear'), mk('Stop', 'q.stop'));
  p.appendChild(q);
  const up = find('u.act');
  const brainCtl = find('s.brain');
  if (brainCtl && brainCtl.lead) p.appendChild(banner('', 'what Tessaya works through', 'Choose', 'Claude Code or Codex. You can change it later.', 'Choose', () => go('assistant')));
  else if (up && up.lead) p.appendChild(banner('', 'a quiet moment', 'Tessaya will restart in', up.hint, null));
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
  p.appendChild($('p', 'lede', 'Words Tessaya should spell your way. It adds the ones you correct or use a lot, and you can add your own.')).style.marginTop = '6px';
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
let hmenu = null, hq = '', hrows = null, hopen = new Set(), hask = null, hnote = '', htimer = null, hbusy = new Set(), hlimit = 40, hrec = false;
function loadHistory() {
  const run = real ? ipc.invoke('baton-history:list', hq) : Promise.resolve((window.__BATON_HISTORY__ || []).filter(t => !hq || (t.raw + ' ' + (t.cleaned || '') + ' ' + t.app).toLowerCase().includes(hq.toLowerCase())));
  run.then(r => { hrows = r; render(); });
}
function hact(t, action) {
  if (action === 'delete') { hask = null; }
  if (!real) { if (action === 'delete') { hrows = hrows.filter(x => x.id !== t.id); render(); } else { hnote = 'Copied.'; render(); } return; }
  const retry = action === 'retry' || action === 'retry_transcript';
  if (retry) { hbusy.add(t.id); hnote = action === 'retry_transcript' ? 'Listening to the recording again. A long one takes a while.' : ''; render(); }
  ipc.invoke('baton-history:act', t.id, action).then(r => {
    hbusy.delete(t.id);
    if (action === 'delete') hrows = hrows.filter(x => x.id !== t.id);
    else if (r && r.failed) { hnote = r.failed; }
    else if (retry && r) { hrows = hrows.map(x => x.id === t.id ? r : x); hopen.add(t.id); hnote = action === 'retry_transcript' ? 'Done. The new words sit beside the old ones under Compare.' : (r.status === 'ok' ? 'Cleaned again. Copy it from the row.' : 'Clean-up failed again. The words as heard are still here.'); }
    else if (action.indexOf('use_version') === 0 && r) { hrows = hrows.map(x => x.id === t.id ? r : x); hnote = 'Now using that version.'; }
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
  if (!window.__hm) { window.__hm = 1; document.addEventListener('click', e => { if (hmenu && !e.target.closest('.hmenuwrap')) { hmenu = null; render(); } }); }
  const f = $('div', 'hsearch'); const q = $('input'); q.type = 'search'; q.id = 'in-hq'; q.placeholder = 'Search what you said'; q.setAttribute('aria-label', 'Search history'); q.value = hq;
  q.oninput = () => { hq = q.value; hlimit = 40; clearTimeout(htimer); htimer = setTimeout(loadHistory, 180); };
  f.appendChild(q); p.appendChild(f);
  if (hnote) { const n = $('p', 'hint', hnote); n.style.margin = '0 0 10px'; p.appendChild(n); }
  if (hrows === null) { p.appendChild($('div', 'empty', 'Loading.')); recordings(p); return; }
  if (!hrows.length) { p.appendChild($('div', 'empty', hq ? 'Nothing matches.' : 'Nothing yet. Things you say to Tessaya and dictate show up here.')); recordings(p); return; }
  const shownRows = hrows.slice(0, hlimit);
  const perDay = {}; for (const t of shownRows) { const d = dayLabel(t.at); perDay[d] = (perDay[d] || 0) + 1; }
  let day = null, g = null;
  for (const t of shownRows) {
    const d = dayLabel(t.at); if (d !== day) { day = d; const dh = $('div', 'day'); dh.append(document.createTextNode(d), $('span', 'daycount', ' · ' + perDay[d])); p.appendChild(dh); g = $('div', 'group'); p.appendChild(g); }
    const wrap = $('div', 'hrow'); const line = $('div', 'hline'); const head = $('button', 'hhead'); head.setAttribute('aria-expanded', String(hopen.has(t.id)));
    const text = t.kind === 'spoken' ? t.raw : (t.cleaned || t.raw); head.append($('time', null, clock(t.at)), $('span', 'htext', text.length > 170 ? text.slice(0, 170) + '…' : text), $('span', 'badge ' + (t.status === 'ok' ? 'added' : t.status === 'none' ? 'learned' : 'warnb'), t.kind === 'spoken' ? 'Spoken' : STATUS[t.status] || t.status));
    head.onclick = () => { if (hopen.has(t.id)) hopen.delete(t.id); else hopen.add(t.id); render(); };
    const cp = $('button', 'hcopy', 'Copy'); cp.setAttribute('aria-label', t.kind === 'spoken' && t.cleaned ? 'Copy the reply' : 'Copy this transcript'); cp.onclick = () => hact(t, 'copy');
    line.append(head, cp);
    if (t.menu && t.menu.length) {
      const mw = $('span', 'hmenuwrap'); const more = $('button', 'hmore', '\u22EF'); more.setAttribute('aria-label', 'More actions'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', String(hmenu === t.id));
      more.onclick = (e) => { e.stopPropagation(); hmenu = hmenu === t.id ? null : t.id; render(); };
      mw.appendChild(more);
      if (hmenu === t.id) {
        const m = $('div', 'hmenu'); m.setAttribute('role', 'menu');
        for (const it of t.menu) {
          const b = $('button', 'hitem' + (it.enabled ? '' : ' off'), hbusy.has(t.id) && it.id === 'retry_transcript' ? 'Retrying' : it.label); b.setAttribute('role', 'menuitem');
          if (it.note) b.title = it.note;
          b.onclick = (e) => { e.stopPropagation(); hmenu = null;
            if (it.id === 'delete') { hask = t.id; hopen.add(t.id); render(); }
            else if (!it.enabled) { hnote = it.note || 'Not available right now.'; render(); }
            else hact(t, it.id); };
          m.appendChild(b);
        }
        mw.appendChild(m);
      }
      line.appendChild(mw);
    }
    wrap.appendChild(line);
    if (hopen.has(t.id)) {
      const body = $('div', 'hbody');
      const blk = (l, x) => { const b = $('div', 'hblock'); b.append($('div', 'hint', l), $('div', 'hpre', x)); return b; };
      if (t.kind === 'spoken') { body.appendChild(blk('You said', t.raw)); if (t.cleaned) body.appendChild(blk('Tessaya replied', t.cleaned)); }
      else { body.appendChild(blk('As heard', t.raw)); if (t.cleaned) body.appendChild(blk('Written', t.cleaned)); }
      const rt = (t.menu || []).find(i => i.id === 'retry_transcript');
      if (rt && rt.note) body.appendChild($('div', 'hint', rt.note + '.'));
      if (t.versions && t.versions.length > 1) {
        const cmp = $('div', 'hblock'); cmp.appendChild($('div', 'hint', 'Compare'));
        t.versions.forEach((v, i) => {
          const inUse = v.raw === t.raw && (v.cleaned || null) === (t.cleaned || null);
          const row = $('div', 'hver'); const lab = $('div', 'hint', 'Version ' + (i + 1) + (i === 0 ? ' (first heard)' : '') + (inUse ? ' - in use' : ''));
          const txt = $('div', 'hpre', t.kind === 'spoken' ? v.raw : (v.cleaned || v.raw));
          const ra = $('div', 'hacts');
          const vb = (l, a) => { const b = $('button', 'btn quiet', l); b.onclick = () => hact(t, a + ':' + i); return b; };
          ra.appendChild(vb('Copy', 'copy_version')); if (!inUse) ra.appendChild(vb('Use this one', 'use_version'));
          row.append(lab, txt, ra); cmp.appendChild(row);
        });
        body.appendChild(cmp);
      }
      const meta = [t.app && ('in ' + t.app), t.delivery && ('delivered: ' + t.delivery), t.model && ('tidied by ' + t.model), t.audio ? 'recording kept' : null, t.corrected ? 'you corrected it' : null, t.error].filter(Boolean).join(' · ');
      if (meta) body.appendChild($('div', 'hint', meta));
      const acts = $('div', 'hacts');
      const mk = (l, fn, cls) => { const b = $('button', 'btn ' + (cls || 'quiet'), l); b.onclick = fn; return b; };
      acts.appendChild(mk('Copy as heard', () => hact(t, 'copy_raw')));
      if (t.cleaned) acts.appendChild(mk(t.kind === 'spoken' ? 'Copy reply' : 'Copy written', () => hact(t, 'copy_cleaned')));
      if (rt && rt.enabled) acts.appendChild(mk(hbusy.has(t.id) ? 'Retrying' : 'Retry transcript', () => hact(t, 'retry_transcript')));
      if ((t.menu || []).some(i => i.id === 'retry')) acts.appendChild(mk(hbusy.has(t.id) ? 'Cleaning' : 'Retry clean-up', () => hact(t, 'retry'), 'primary'));
      if (hask === t.id) { acts.append($('span', 'hint', 'Delete this for good?'), mk('Delete', () => hact(t, 'delete'), 'primary'), mk('Keep', () => { hask = null; render(); })); }
      else acts.appendChild(mk('Delete', () => { hask = t.id; render(); }));
      body.appendChild(acts); wrap.appendChild(body);
    }
    g.appendChild(wrap);
  }
  if (hrows.length > hlimit) { const more = $('button', 'btn quiet', 'Show older (' + (hrows.length - hlimit) + ')'); more.style.marginTop = '12px'; more.onclick = () => { hlimit += 40; render(); }; p.appendChild(more); }
  recordings(p);
}
const tabName = id => (TABS.find(t => t[0] === id) || [id, 'Settings'])[1];
/** Every setting whose words contain every word typed, shown as the real rows, with the page each one lives on. */
function searchPage(p) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = S.controls.filter(c => c.kind !== 'session' && words.every(w => (c.label + ' ' + (c.hint || '') + ' ' + (c.section || '')).toLowerCase().includes(w)));
  p.appendChild(pageHead('Search', hits.length ? hits.length + (hits.length === 1 ? ' setting' : ' settings') + ' for \u201c' + query + '\u201d' : 'Nothing matches \u201c' + query + '\u201d. Try a shorter word.'));
  const by = new Map(); for (const c of hits) { const t = c.tab || 'settings'; if (!by.has(t)) by.set(t, []); by.get(t).push(c); }
  for (const [t, list] of by) { const h = $('h2', null, tabName(t)); const go2 = $('button', 'moreBtn', 'Open ' + tabName(t)); go2.onclick = () => { query = ''; go(t); }; h.appendChild(go2); p.appendChild(h); const g = $('div', 'group'); rowsOf(list, g); p.appendChild(g); }
}
function tabPage(p) {
  if (query.trim() && !modal) return searchPage(p);
  if (cur === 'home') return home(p);
  const intro = INTRO[cur]; p.appendChild(pageHead(intro[0], intro[1]));
  if (cur === 'usage') return usage(p);
  if (cur === 'history') return historyPage(p);
  const items = tabControls(cur);
  const EMPTY = { sessions: 'No sessions yet. Start one in Claude Code or T3 and it appears here.', approvals: 'Nothing is waiting for your yes.', jobs: 'No jobs yet. Ask Tessaya to take on a long piece of work and it appears here.', memory: 'Nothing remembered yet. Say \u201cremember that\u2026\u201d and it is kept here.', tools: 'No plugins, skills or servers found yet.' };
  if (!items.length && EMPTY[cur]) p.appendChild($('div', 'empty', EMPTY[cur]));
  for (const s of sections(items)) { if (sections(items).length > 1 || s.name !== intro[0]) p.appendChild($('h2', null, s.name)); p.appendChild(group(s.name, s.items)); }
  if (cur === 'dictation') { vocabulary(p); keys(p, ['dictation']); }
  if (cur === 'voice') keys(p, ['voice']);
  if (cur === 'screen') {
    p.insertBefore($('h2', null, 'Actions'), p.firstChild.nextSibling.nextSibling);
    const ag = $('div', 'group');
    for (const [l, h, b, id] of [['Ask Tessaya', 'Type a question about your screen or a job to do.', 'Ask', 'q.ask'], ['Clear the screen', 'Remove the pointer and any card Tessaya left up.', 'Clear', 'q.clear'], ['Stop', 'End a lesson or a drive, and quiet Tessaya\u2019s voice.', 'Stop', 'q.stop']]) { const r = $('div', 'row'); const t = $('div', 'text'); t.append($('div', 'label', l), $('div', 'hint', h)); const bt = $('button', 'btn', b); bt.onclick = () => set(id, null); r.append(t, bt); ag.appendChild(r); }
    p.insertBefore(ag, p.firstChild.nextSibling.nextSibling.nextSibling);
    p.appendChild($('h2', null, 'What Tessaya can do with your screen'));
    const hg = $('div', 'group');
    for (const [l, h] of [['Look', 'Ask what is on your screen. Tessaya takes one screenshot of each display and answers.'], ['Teach', 'Ask how to do something. Tessaya shows each step on your screen, one at a time.'], ['Drive', 'Ask Tessaya to do it. It moves the pointer, you can take over, and Escape stops it.']]) { const r = $('div', 'kv'); const t = $('div'); t.append($('div', 'label', l), $('div', 'hint', h)); r.appendChild(t); hg.appendChild(r); }
    p.appendChild(hg);
    keys(p, ['screen']);
  }
  if (cur === 'checks') { if (!items.some(c => c.kind === 'check')) { const e = $('div', 'empty', 'Nothing has run yet. Press Run checks.'); e.style.marginTop = '16px'; p.appendChild(e); } const x = S.extra || {}; if ((x.lifecycle || []).length) { p.appendChild($('h2', null, 'Why Tessaya last went down')); const g = $('div', 'group'); for (const l of x.lifecycle) { const r = $('div', 'kv'); r.append($('div', null, l.text), $('time', 'hint', clock(l.at))); g.appendChild(r); } p.appendChild(g); } }
}

const MODAL = [['General', 'general'], ['System', 'system'], ['Keyboard and mouse', 'keys'], ['Account', 'account'], ['Updates', 'updates'], ['About', 'about']];
let capturing = null, capNote = '';
function keyName(e) { const k = e.key; if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'Dead', 'Unidentified'].includes(k)) return null; const m = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Escape: 'Escape' }; return m[k] || (k.length === 1 ? k.toUpperCase() : k); }
function accel(e) { const k = keyName(e); if (!k) return null; const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean); return mods.concat([k]).join('+'); }
function chips(input) { const w = $('div', 'chips'); if (!input) { w.appendChild($('span', 'hint', 'Off')); return w; } if (input.type === 'key') input.accelerator.split('+').forEach(x => w.appendChild($('kbd', null, x))); else w.appendChild($('span', 'chip plain', ({ middle: 'Middle button', back: 'Back button', forward: 'Forward button', 'left+right': 'Left and right together' })[input.button] || input.button)); return w; }
const BTN = { middle: 'Middle button', back: 'Back button', forward: 'Forward button', 'left+right': 'Left and right together' };
function inputLabel(i) { return i.type === 'key' ? i.accelerator.split('+').join(' + ') : (BTN[i.button] || i.button); }
function bindingsPage(b) {
  const x = S.extra || {}; const rows = x.bindings || [];
  b.appendChild($('h1', null, 'Keyboard and mouse'));
  b.appendChild($('p', 'lede', 'Give each action up to four ways to start it. Voice always works with no button at all.'));
  if (x.bindingsNote) { const n = $('p', 'fix', x.bindingsNote); n.style.color = 'var(--warn)'; b.appendChild(n); }
  const g = $('div', 'group');
  for (const r of rows) {
    const wrap = $('div', 'rowwrap'); const row = $('div', 'row'); row.style.alignItems = 'flex-start';
    const t = $('div', 'text'); t.style.cssText = 'flex:1;min-width:0'; t.append($('div', 'label', r.label), $('div', 'hint', r.hint));
    if (r.inputs.some(i => i.type === 'mouse') && !x.mouseReady) t.appendChild($('div', 'hint', 'Saved. Mouse buttons start working with Tessaya’s input helper.'));
    for (const c of (r.conflicts || [])) { const i = r.inputs[c.index]; if (!i) continue; const f = $('div', 'fix', inputLabel(i) + ' is also used by ' + c.with.join(' and ') + '. Only one of them will work.'); f.style.color = 'var(--warn)'; t.appendChild(f); }
    const side = $('div'); side.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px;max-width:60%';
    const on = capturing === r.action;
    if (!r.inputs.length) side.appendChild($('span', 'hint', 'Off'));
    r.inputs.forEach((i, n) => {
      const c = $('span', 'chipx'); c.appendChild(chips(i));
      const rm = $('button', 'x'); rm.appendChild(icon('x', 12)); rm.setAttribute('aria-label', 'Remove ' + inputLabel(i)); rm.onclick = () => set('b.remove:' + r.action, n); c.appendChild(rm); side.appendChild(c);
    });
    if (r.inputs.length < 4) { const ch = $('button', 'btn quiet', on ? 'Cancel' : (r.inputs.length ? 'Add another' : 'Add')); ch.onclick = () => { capturing = on ? null : r.action; capNote = ''; render(); }; side.appendChild(ch); }
    else side.appendChild($('span', 'hint', 'Four is the most'));
    if (!r.isDefault && !on) { const rs = $('button', 'btn quiet', 'Reset'); rs.onclick = () => set('b.reset:' + r.action, null); side.appendChild(rs); }
    row.append(t, side); wrap.appendChild(row);
    if (on) { const cap = $('div', 'inline capture'); cap.appendChild($('div', 'label', 'Press a key or a chord of up to three keys, or click a mouse button. Escape cancels.')); if (capNote) cap.appendChild($('div', 'hint', capNote)); wrap.appendChild(cap); }
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
  if (bare && !/^(F\\d+|Pause|ScrollLock)$/.test(a)) { capNote = 'Add Ctrl, Alt or Shift so it does not get in the way of typing.'; render(); return; }
  const id = capturing; capturing = null; capNote = ''; set('b.add:' + id, JSON.stringify({ type: 'key', accelerator: a }));
}, true);
addEventListener('mousedown', e => {
  if (!capturing) return;
  let button = null;
  if (e.buttons === 3) button = 'left+right'; else if (e.button === 1) button = 'middle'; else if (e.button === 3) button = 'back'; else if (e.button === 4) button = 'forward';
  if (!button) return;
  e.preventDefault(); const id = capturing; capturing = null; capNote = ''; set('b.add:' + id, JSON.stringify({ type: 'mouse', button }));
}, true);
function modalPage(b) {
  const x = S.extra || {};
  const rows = ids => S.controls.filter(c => ids.includes(c.id));
  if (modal === 'general') { b.appendChild($('h1', null, 'General')); const g = $('div', 'group'); const items = rows(['v.appearance', 'v.login']); for (const c of items) g.appendChild(row(c)); const q = $('div', 'row'); const t = $('div', 'text'); t.append($('div', 'label', 'Quit Tessaya'), $('div', 'hint', 'Closing the window keeps Tessaya in the tray. Quit ends it.')); const qb = $('button', 'btn', 'Quit'); qb.onclick = () => set('q.quit', null); q.append(t, qb); g.appendChild(q); b.appendChild(g); }
  else if (modal === 'system') { b.appendChild($('h1', null, 'System')); const g = $('div', 'group'); for (const c of rows(['v.file'])) g.appendChild(row(c)); for (const p of (x.paths || [])) { const r = $('div', 'kv'); const t = $('div'); t.append($('div', 'label', p.label), $('div', 'hint', p.path)); const ob = $('button', 'btn', 'Open'); ob.onclick = () => set('q.open:' + p.id, null); r.append(t, ob); g.appendChild(r); } b.appendChild(g); }
  else if (modal === 'keys') bindingsPage(b);
  else if (modal === 'account') { b.appendChild($('h1', null, 'Account')); const g = $('div', 'group'); for (const c of rows(['s.account', 's.accountEmail'])) g.appendChild(row(c)); b.appendChild(g); const n = $('p', 'hint', 'Tessaya uses your own subscription through the claude and codex programs. It never uses an API key.'); n.style.marginTop = '12px'; b.appendChild(n); }
  else if (modal === 'updates') { b.appendChild($('h1', null, 'Updates')); const g = $('div', 'group'); for (const c of rows(['u.act'])) g.appendChild(row(c)); const ab = x.about || {}; for (const [l, v] of [['Installed version', ab.version], ['Updates come from', ab.source]]) { if (!v) continue; const r = $('div', 'kv'); r.append($('div', 'label', l), $('div', 'hint', v)); g.appendChild(r); } b.appendChild(g); b.appendChild($('p', 'hint', 'Tessaya downloads an update in the background and tells you before it restarts.')).style.marginTop = '12px'; }
  else { const am = $('div', 'aboutmark'); am.innerHTML = markHtml(); b.appendChild(am); if (!aboutSeen) { aboutSeen = true; setTimeout(startSting, 50); } b.appendChild($('h1', null, 'About')); const a = x.about || {}; const g = $('div', 'group'); for (const [l, v] of [['Version', a.version], ['Installed from', a.source], ['Licence', a.licence], ['Third-party notices', a.notices]]) { if (!v) continue; const r = $('div', 'kv'); r.append($('div', 'label', l), $('div', 'hint', v)); g.appendChild(r); } b.appendChild(g); }
}
/** Swaps a region's contents only when what it would show has changed, so a refresh that changes nothing touches nothing. */
function setRegion(el, build) {
  const next = document.createElement('div'); build(next);
  if (next.innerHTML === el.innerHTML) return false;
  el.replaceChildren(...next.childNodes); return true;
}
let shownModal = null, lastSig = '';
function ensureVeil() {
  let v = document.getElementById('veil'); if (v) return v;
  v = $('div'); v.id = 'veil'; v.onclick = e => { if (e.target === v) closeModal(); };
  const m = $('div'); m.id = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Settings');
  const nav = $('div'); nav.id = 'mnav'; const body = $('div'); body.id = 'mbody';
  m.append(nav, body); v.appendChild(m); document.body.appendChild(v); return v;
}
/** The dialog is built once and kept: a tab switch changes the nav mark and the content, nothing else. */
function syncModal() {
  const v = ensureVeil();
  if (!modal) {
    shownModal = null;
    if (v.classList.contains('on') && !v.classList.contains('out')) { v.classList.add('out'); setTimeout(() => { if (!modal) v.className = ''; }, 170); }
    return;
  }
  v.classList.remove('out'); v.classList.add('on');
  setRegion(document.getElementById('mnav'), nav => {
    nav.appendChild($('h4', null, 'Settings'));
    for (const [l, id] of MODAL) { if (id === 'account') nav.appendChild($('h4', null, 'Account')); const b = $('button', 'nav', l); if (modal === id) b.setAttribute('aria-current', 'page'); b.onclick = () => { modal = id; render(); }; nav.appendChild(b); }
    nav.appendChild($('div', 'ver', 'Tessaya ' + (((S.extra || {}).about || {}).version || '')));
  });
  const mbody = document.getElementById('mbody');
  setRegion(mbody, body => { const cl = $('button', 'ibtn'); cl.id = 'mclose'; cl.setAttribute('aria-label', 'Close'); cl.appendChild(icon('x')); cl.onclick = closeModal; body.appendChild(cl); modalPage(body); });
  if (shownModal !== modal) { mbody.scrollTop = 0; shownModal = modal; }
}
function closeModal() { modal = null; aboutSeen = false; render(); }
function go(t) { cur = t; render(); if (real) ipc.send('baton-home:tab', t); document.getElementById('panel').scrollTop = 0; }

function render(state) {
  if (state) { const sig = JSON.stringify(state); if (sig === lastSig) return; lastSig = sig; S = state; }
  const keep = document.activeElement && document.activeElement.id, pos = document.activeElement && document.activeElement.selectionStart;
  const app = document.getElementById('app'); app.className = collapsed ? 'collapsed' : '';
  const need = (S.extra && S.extra.stats && S.extra.stats.needYou) || 0; const up = find('u.act');
  setRegion(document.getElementById('side'), side => {
  const brand = $('div', 'brand'); const mk = $('span'); mk.id = 'mark'; mk.innerHTML = markHtml(); const bt = $('span', 'bt'); bt.append($('b', null, 'Tessaya'), $('span', 'plan', 'v' + (((S.extra || {}).about || {}).version || ''))); brand.append(mk, bt); side.appendChild(brand);
  const nav = $('nav'); 
  for (const [id, label] of TABS) { const b = $('button', 'nav'); if (cur === id) b.setAttribute('aria-current', 'page'); b.append(icon(id), $('span', null, label)); if (id === 'sessions' && need) b.appendChild($('span', 'n', String(need))); b.onclick = () => go(id); nav.appendChild(b); }
  side.appendChild(nav); side.appendChild($('div', 'spacer'));
  if (up && up.lead) { const c = $('div', 'sidecard go'); c.append($('b', null, 'Update ready'), $('p', null, 'Tessaya restarts itself and reopens this window.')); const bt = $('button', 'btn', up.button); bt.onclick = () => set('u.act', null); c.appendChild(bt); side.appendChild(c); }
  const foot = $('div', 'foot'); const st = $('button', 'nav'); st.append(icon('settings'), $('span', null, 'Settings')); st.onclick = () => { modal = 'general'; render(); };
  const t3 = $('button', 'nav'); t3.append(icon('external'), $('span', null, 'Open T3 sessions')); t3.onclick = () => real && ipc.send('baton-home:sessions');
  foot.append(t3, st); side.appendChild(foot);
  });
  setRegion(document.getElementById('top'), top => {
  const sb = $('input', 'search'); sb.id = 'q'; sb.type = 'search'; sb.placeholder = 'Search settings'; sb.setAttribute('aria-label', 'Search settings'); sb.value = query; sb.oninput = () => { query = sb.value; render(); }; sb.onkeydown = e => { if (e.key === 'Escape' && query) { query = ''; render(); } };
  const tg = $('button', 'ibtn'); tg.setAttribute('aria-label', 'Show or hide the sidebar'); tg.appendChild(icon('side')); tg.onclick = () => { collapsed = !collapsed; render(); }; top.appendChild(tg);
  const stt = $('div', 'state'); const d = $('span', 'dot'); d.setAttribute('data-tone', S.status.tone); stt.append(d, $('span', null, S.status.label + (S.status.device ? ' \\u00b7 ' + S.status.device : ''))); top.appendChild(stt);
  const vb = find('vt.bar'); if (vb && vb.state === 'unlocked') { const lk = $('button', 'ibtn'); lk.setAttribute('aria-label', 'Lock the vault'); lk.setAttribute('title', 'Lock the vault'); lk.appendChild(icon('vault')); lk.onclick = () => set('vt.lock', null); top.appendChild(lk); }
  const bell = $('button', 'ibtn'); bell.setAttribute('aria-label', 'Alerts'); bell.appendChild(icon('bell')); if ((up && up.lead) || need) bell.appendChild($('span', 'pip')); bell.onclick = () => go(need ? 'sessions' : 'home'); top.appendChild(bell);
  const ac = $('button', 'ibtn'); ac.setAttribute('aria-label', 'Account'); ac.appendChild(icon('user')); ac.onclick = () => { modal = 'account'; render(); }; top.appendChild(sb); top.appendChild(ac);
  });
  const page = document.getElementById('page'); const pageClass = cur === 'home' ? 'wide' : ''; if (page.className !== pageClass) page.className = pageClass; setRegion(page, tabPage);
  syncModal();
  if (keep && (keep.indexOf('in-') === 0 || keep === 'q')) { const e = document.getElementById(keep); if (e) { e.focus(); if (pos != null) e.setSelectionRange(pos, pos); } }
}
addEventListener('keydown', e => { if (e.key === 'Escape' && modal) closeModal(); });
if (real) ipc.on('baton-home:state', (_e, s) => render(s));
if (real) ipc.on('baton-home:theme', (_e, t) => { document.documentElement.dataset.theme = t; });
get().then(s => { render(s); startSting(); });
`;
