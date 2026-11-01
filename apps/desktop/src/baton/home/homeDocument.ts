/**
 * The page behind Baton's own window. Plain DOM, no framework: it is a few rows of controls. Outside
 * Electron it reads `window.__BATON_STATE__` so the page can be looked at in any browser.
 * Text goes in with textContent only; the state is data, never markup.
 */
export const HOME_CSS = `
:root{
  --ground:#f5f2ec;--card:#fffdf9;--ink:#1c1b18;--soft:#6b675e;--faint:#9a958a;--line:#e6e1d6;--line-strong:#d6d0c2;
  --accent:#1f6f5b;--accent-ink:#fff;--accent-wash:#e3efe9;--warn:#b4691f;--bad:#b3423a;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:"Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  --ease:cubic-bezier(.2,.8,.2,1);
}
*{box-sizing:border-box}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
main{animation:rise .32s var(--ease) both}
html,body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.45 var(--sans);-webkit-font-smoothing:antialiased;user-select:none;cursor:default}
main{max-width:600px;margin:0 auto;padding:36px 28px 56px}
header{display:flex;align-items:center;gap:14px;margin-bottom:28px}
#mark{display:block;width:44px;height:44px;flex:none}#mark svg{width:100%;height:100%;display:block;filter:drop-shadow(0 1px 1px rgba(28,27,24,.18))}
h1{font:600 32px/1.1 var(--serif);letter-spacing:-.01em;margin:0}
.status{margin:2px 0 0;color:var(--soft);display:flex;align-items:center;gap:8px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--faint);flex:none}
.dot[data-tone=good]{background:var(--accent)}.dot[data-tone=warn]{background:var(--warn)}.dot[data-tone=off]{background:var(--bad)}
h2{font:600 12px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:30px 0 10px 4px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 1px 0 rgba(28,27,24,.03),0 8px 24px -16px rgba(28,27,24,.18)}
.row{transition:background .15s;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 18px;border-top:1px solid var(--line)}
.card>.row:first-child,.card>.rows:first-child>.row:first-child{border-top:0}
.row[data-disabled]{opacity:.5;pointer-events:none}
.row:hover{background:#fbf8f2}.text{min-width:0}
.label{font-weight:600}
.hint{color:var(--soft);font-size:13px;margin-top:1px}
.more{display:grid;grid-template-rows:0fr;transition:grid-template-rows .24s var(--ease)}
.more>div{overflow:hidden;min-height:0}
.card.open .more{grid-template-rows:1fr}
.card:not(.open) .more .row{visibility:hidden}
.moreBtn{display:flex;width:100%;align-items:center;gap:6px;padding:11px 18px;border:0;border-top:1px solid var(--line);background:transparent;color:var(--soft);font:600 13px var(--sans);cursor:pointer;text-align:left}
.moreBtn:hover{color:var(--ink);background:#faf7f1}
.moreBtn svg{transition:transform .2s var(--ease)}
.card.open .moreBtn svg{transform:rotate(180deg)}
button,select{font:inherit;color:inherit}
button:focus-visible,select:focus-visible,.sw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sw{position:relative;width:40px;height:24px;flex:none;border-radius:12px;border:0;background:var(--line-strong);cursor:pointer;transition:background .18s}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .2s var(--ease)}
.sw[aria-checked=true]{background:var(--accent)}.sw[aria-checked=true]::after{transform:translateX(16px)}
.seg{display:flex;background:#efebe2;border-radius:10px;padding:3px;gap:2px;flex:none}
.seg button{border:0;background:transparent;padding:6px 12px;border-radius:8px;cursor:pointer;color:var(--soft);font-weight:600;font-size:13px}
.seg button[aria-pressed=true]{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
select{appearance:none;border:1px solid var(--line-strong);background:var(--card);border-radius:9px;padding:6px 28px 6px 11px;font-size:13px;max-width:230px;cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%236b675e' stroke-width='1.6'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
.btn{border:1px solid var(--line-strong);background:var(--card);border-radius:9px;padding:6px 13px;font-weight:600;font-size:13px;cursor:pointer;flex:none}
.btn:hover{border-color:var(--ink)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
footer{margin-top:30px;display:flex;justify-content:space-between;align-items:center;color:var(--faint);font-size:13px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const PAGE_SCRIPT = `
const $=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;};
const real=typeof require==='function';
const ipc=real?require('electron').ipcRenderer:null;
const get=()=>real?ipc.invoke('baton-home:get'):Promise.resolve(window.__BATON_STATE__);
const set=(id,v)=>real?ipc.invoke('baton-home:set',id,v).then(render):Promise.resolve();
const open=new Set();
const CHEVRON='<svg width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l4 4 4-4"/></svg>';
function control(c){
  if(c.kind==='toggle'){const b=$('button','sw');b.setAttribute('role','switch');b.setAttribute('aria-checked',String(c.on));b.setAttribute('aria-label',c.label);b.onclick=()=>set(c.id,!c.on);return b;}
  if(c.kind==='choice'){
    if(c.options.length<=3&&c.options.reduce((n,o)=>n+o.label.length,0)<=32){const s=$('div','seg');for(const o of c.options){const b=$('button',null,o.label);b.setAttribute('aria-pressed',String(o.value===c.value));b.onclick=()=>set(c.id,o.value);s.appendChild(b);}return s;}
    const s=$('select');s.setAttribute('aria-label',c.label);for(const o of c.options){const p=$('option',null,o.label);p.value=o.value;p.selected=o.value===c.value;s.appendChild(p);}s.onchange=()=>set(c.id,s.value);return s;
  }
  if(c.kind==='secret'){const b=$('button','btn',c.masked);b.setAttribute('aria-label','Show address');b.onclick=()=>{b.textContent=b.textContent===c.masked?c.revealed:c.masked;};return b;}
  const b=$('button','btn',c.button);b.onclick=()=>set(c.id,null);return b;
}
function row(c){
  const r=$('div','row');if(c.disabled)r.setAttribute('data-disabled','');
  const t=$('div','text');t.appendChild($('div','label',c.label));if(c.hint)t.appendChild($('div','hint',c.hint));
  r.append(t,control(c));return r;
}
function render(state){
  state=state||window.__last;window.__last=state;
  document.getElementById('mark').innerHTML=state.status.mark;
  const m=document.getElementById('app');m.replaceChildren();
  const st=document.getElementById('status');st.replaceChildren();
  const d=$('span','dot');d.setAttribute('data-tone',state.status.tone);st.append(d,$('span',null,state.status.label+(state.status.device?' · '+state.status.device:'')));
  const sections=[];for(const c of state.controls){let s=sections.find(x=>x.name===c.section);if(!s){s={name:c.section,items:[]};sections.push(s);}s.items.push(c);}
  for(const s of sections){
    m.appendChild($('h2',null,s.name));
    const card=$('div','card'+(open.has(s.name)?' open':''));
    for(const c of s.items.filter(x=>!x.more))card.appendChild(row(c));
    const more=s.items.filter(x=>x.more);
    if(more.length){
      const w=$('div','more'),i=$('div');for(const c of more)i.appendChild(row(c));w.appendChild(i);card.appendChild(w);
      const b=$('button','moreBtn');b.setAttribute('aria-expanded',String(open.has(s.name)));b.append($('span',null,open.has(s.name)?'Fewer options':'More options'));b.insertAdjacentHTML('beforeend',CHEVRON);
      b.onclick=()=>{if(open.has(s.name))open.delete(s.name);else open.add(s.name);card.classList.toggle('open');b.setAttribute('aria-expanded',String(open.has(s.name)));b.firstChild.textContent=open.has(s.name)?'Fewer options':'More options';};
      card.appendChild(b);
    }
    m.appendChild(card);
  }
}
document.getElementById('sessions').onclick=()=>real&&ipc.send('baton-home:sessions');
if(real)ipc.on('baton-home:state',(_e,s)=>render(s));
get().then(render);
`;

export const HOME_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Baton</title><style>${HOME_CSS}</style></head><body><main>
<header><span id="mark"></span><div><h1>Baton</h1><p class="status" id="status"></p></div></header>
<div id="app"></div>
<footer><span>Changes save as you make them.</span><button class="btn" id="sessions">Open sessions</button></footer>
</main><script>${PAGE_SCRIPT}</script></body></html>`;
