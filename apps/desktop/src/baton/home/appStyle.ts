import { FONT_FACES } from "./fonts.ts";

/**
 * The look of Baton's window (D140): a warm cream ground, a sidebar of tabs, one raised panel for
 * the page, a serif for what is said to him and a plain sans for everything he operates. One accent,
 * the Woad dye (#14505A, #5FB3B3 on dark, from the logo kit); amber only for "needs you". Motion is short and one-off, with a reduced-motion
 * fallback; nothing repaints continuously.
 */
/** The dark theme: a warm near-black ground, panels one step lighter, hairline rules, edge light instead of shadow. */
export const DARK_TOKENS = `[data-theme=dark]{
  --ground:#111214;--side:#15161a;--panel:#1a1b1f;--sunk:#202127;--ink:#ebebe8;--soft:#a6a8b0;--faint:#8c8f98;
  --line:#2a2c32;--line-strong:#3b3e46;--accent:#5FB3B3;--accent-deep:#12292D;--accent-wash:#163035;--accent-ink:#0F1B1E;
  --warn:#e3a553;--warn-wash:#33270f;--bad:#f08a80;--bad-wash:#3b1f1c;
  --hover:rgba(255,255,255,.055);--row-hover:rgba(255,255,255,.035);--quiet:#2a2c32;--accent-edge:#2D5A5F;--accent-text:#5FB3B3;
  --focus:#5FB3B3;--on-ink:#15161a;--on-deep:#EEEDE4;--on-deep-soft:#9FD0D0;--btn-deep-bg:#EEEDE4;--btn-deep-fg:#0F1B1E;
  --panel-shadow:inset 0 1px 0 rgba(255,255,255,.05);--veil:rgba(0,0,0,.6);
  --modal-shadow:0 0 0 1px rgba(255,255,255,.08),0 30px 80px -20px rgba(0,0,0,.7);--arrow:%23a6a8b0;color-scheme:dark;
}`;

export const APP_CSS = `
${FONT_FACES}
/* Bone paper, near-black ink, one Woad accent; amber stays for "needs you", red for errors. */
:root{
  --ground:#ebe9e4;--side:#e5e3dd;--panel:#f8f7f4;--sunk:#f1efea;--ink:#17181b;--soft:#565961;--faint:#666972;
  --line:#dedbd4;--line-strong:#c9c5bc;--accent:#14505A;--accent-deep:#0E3A42;--accent-wash:#E3EEEF;--accent-ink:#ffffff;
  --warn:#9a5a12;--warn-wash:#f6e8d2;--bad:#a3342c;--bad-wash:#f4e0dd;
  --serif:"Newsreader",Georgia,"Iowan Old Style",Cambria,serif;
  --sans:"Schibsted Grotesk","Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  --ease:cubic-bezier(.2,.8,.2,1);--r:6px;
  --hover:rgba(23,24,27,.05);--row-hover:rgba(248,247,244,.7);--quiet:#e6e4de;--accent-edge:#B7D2D5;--accent-text:#14505A;
  --focus:#14505A;--on-ink:#ffffff;--on-deep:#EEEDE4;--on-deep-soft:#BFD6D8;--btn-deep-bg:#f8f7f4;--btn-deep-fg:#17181b;
  --panel-shadow:none;--veil:rgba(23,24,27,.38);
  --modal-shadow:0 30px 80px -20px rgba(23,24,27,.45);--arrow:%23565961;color-scheme:light;
}
${DARK_TOKENS}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--ground);color:var(--ink);font:14px/1.45 var(--sans);-webkit-font-smoothing:antialiased;user-select:none;cursor:default;overflow:hidden}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer}
button:focus-visible,select:focus-visible,input:focus-visible,.sw:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
svg.i{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}

#app{display:grid;grid-template-columns:236px minmax(0,1fr);grid-template-rows:minmax(0,1fr);height:100%;transition:grid-template-columns .22s var(--ease)}
#app.collapsed{grid-template-columns:0 1fr}
#side{background:var(--side);display:flex;flex-direction:column;padding:16px 12px 12px;overflow:hidden;min-width:0}
#app.collapsed #side{visibility:hidden}
.brand{display:flex;align-items:center;gap:12px;padding:0 6px 20px}
.brand #mark{width:56px;height:56px;display:block;flex:none;color:var(--ink)}
.brand .bt{display:flex;flex-direction:column;gap:1px;min-width:0}
.mk .on-dark{display:none}
[data-theme=dark] .mk .on-light{display:none}
[data-theme=dark] .mk .on-dark{display:inline}
#page{position:relative}
.homemark{position:absolute;right:36px;top:30px;width:72px;height:72px;color:var(--ink);opacity:.92}
.homemark svg{width:100%;height:100%;display:block}
.aboutmark{width:96px;height:96px;margin:0 0 14px;color:var(--ink)}
.aboutmark svg{width:100%;height:100%;display:block}
.brand #mark svg{width:100%;height:100%;display:block}
.brand .plan{margin:0;border:0;background:none;padding:0;font-weight:500;color:var(--faint);font-variant-numeric:tabular-nums}
.brand b{font:600 26px/1.05 var(--serif);letter-spacing:-.01em}
.plan{margin-left:auto;font:600 11px var(--sans);border:1px solid var(--line-strong);border-radius:999px;padding:1px 8px;color:var(--soft);background:var(--panel)}
nav{display:flex;flex-direction:column;gap:2px}
.nav{display:flex;align-items:center;gap:11px;border:0;background:transparent;width:100%;text-align:left;padding:8px 10px;border-radius:9px;color:var(--soft);font-weight:500;transition:background .15s,color .15s}
.nav:hover{background:var(--hover);color:var(--ink)}
.nav[aria-current=page]{background:var(--panel);color:var(--ink);box-shadow:0 0 0 1px var(--line)}
.nav .n{margin-left:auto;font:600 11px var(--sans);min-width:18px;text-align:center;border-radius:999px;padding:1px 6px;background:var(--warn-wash);color:var(--warn)}
.spacer{flex:1}
.sidecard{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 12px 12px;margin:0 2px 10px}
.sidecard b{display:block;font-weight:600}
.sidecard p{margin:2px 0 10px;color:var(--soft);font-size:13px}
.sidecard.go{background:var(--accent-deep);border-color:var(--accent-deep);color:var(--on-deep)}
.sidecard.go p{color:var(--on-deep-soft)}
.sidecard.go .btn{background:var(--btn-deep-bg);color:var(--btn-deep-fg);border-color:var(--btn-deep-bg)}
.foot .nav{color:var(--soft)}

#main{display:flex;flex-direction:column;min-width:0;padding:0 12px 12px 0}
#app.collapsed #main{padding-left:12px}
#top .search{margin-left:auto;width:220px;padding:6px 10px;border-radius:9px;border:1px solid var(--line);background:var(--quiet);color:var(--ink);font:inherit;font-size:13px}#top .search:focus{outline:2px solid var(--line-strong);outline-offset:1px}.rowwrap.stack>.voices,.rowwrap.stack>.brain{margin:0 18px 14px}#top{height:50px;display:flex;align-items:center;gap:8px;padding:0 6px 0 4px;flex:none}
.ibtn{border:0;background:transparent;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:var(--soft);position:relative}
.ibtn:hover{background:var(--hover);color:var(--ink)}
.ibtn .pip{position:absolute;top:7px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--warn);border:2px solid var(--ground)}
.state{margin-left:auto;display:flex;align-items:center;gap:8px;padding:5px 12px 5px 10px;border-radius:999px;background:var(--panel);border:1px solid var(--line);color:var(--soft);font-weight:500}
.dot{width:8px;height:8px;border-radius:50%;background:var(--faint);flex:none}
.dot[data-tone=good]{background:var(--accent)}.dot[data-tone=warn]{background:var(--warn)}.dot[data-tone=off]{background:var(--bad)}
#panel{flex:1;min-height:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--panel-shadow);overflow:auto}
#page.wide{max-width:1100px}
#page{max-width:900px;margin:0 auto;padding:34px 36px 56px;animation:rise .28s var(--ease) both}
@keyframes rise{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}

h1{font:400 32px/1.15 var(--serif);letter-spacing:-.012em;margin:0 0 4px}
h1 em{font-style:italic}
.lede{color:var(--soft);margin:0 0 22px;max-width:60ch}
h2{font:600 15px var(--sans);margin:30px 0 10px}
h2 small{font-weight:400;color:var(--faint);margin-left:8px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--accent-edge);background:var(--accent-wash);color:var(--accent-text);border-radius:8px;padding:1px 9px;font:600 .8em var(--sans);vertical-align:2px;margin:0 2px}
.chip.plain{background:var(--sunk);border-color:var(--line-strong);color:var(--ink)}
.quick{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 6px}
.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line-strong);background:var(--panel);border-radius:999px;padding:7px 14px;font-weight:600;font-size:13px}
.pill:hover{border-color:var(--ink)}
.pill[aria-pressed=true]{background:var(--ink);color:var(--on-ink);border-color:var(--ink)}
.pill:disabled{opacity:.45;pointer-events:none}

.banner{display:flex;align-items:center;gap:20px;background:var(--accent-deep);color:var(--on-deep);border-radius:var(--r);padding:20px 24px;margin:20px 0 6px}
.banner h3{font:400 21px/1.25 var(--serif);margin:0 0 3px}
.banner h3 em{font-style:italic}
.banner p{margin:0;color:var(--on-deep-soft);max-width:52ch}
.banner .btn{margin-left:auto;background:var(--btn-deep-bg);color:var(--btn-deep-fg);border-color:var(--btn-deep-bg)}
.banner.warn{background:var(--warn-wash);color:var(--ink)}
.banner.warn p{color:var(--soft)}

.split{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:30px;align-items:start;margin-top:22px}
.rail{min-width:0}
.stats{border:1px solid var(--line);border-radius:12px;padding:6px 18px;background:var(--sunk)}
.stat{padding:12px 0;border-top:1px solid var(--line)}
.stat:first-child{border-top:0}
.stat b{font:400 28px/1 var(--serif);margin-right:8px}
.stat span{color:var(--soft)}
.stat.kvr{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.stat b.sm{font:600 14px var(--sans);margin:0;color:var(--ink)}
.day{font:600 11px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:24px 0 8px}
.day.first{margin-top:0}
.log{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}
.log .li{display:grid;grid-template-columns:78px 1fr auto;gap:14px;padding:12px 16px;border-top:1px solid var(--line);align-items:baseline}
.log .li:first-child{border-top:0}
.log time{color:var(--faint);font-variant-numeric:tabular-nums}
.log .tag{font-size:12px;color:var(--faint)}
.li.dim .tx{color:var(--faint)}
.empty{border:1px dashed var(--line-strong);border-radius:12px;padding:26px;text-align:center;color:var(--soft)}

.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.group{background:var(--sunk);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 18px;border-top:1px solid var(--line);transition:background .15s}
.group>.row:first-child,.group>.rows>.row:first-child{border-top:0}
.row:hover{background:var(--row-hover)}
.row[data-disabled]{opacity:.5;pointer-events:none}
.text{min-width:0}
.label{font-weight:600}
.hint{color:var(--soft);font-size:13px;margin-top:1px}
.more{display:grid;grid-template-rows:0fr;transition:grid-template-rows .24s var(--ease)}
.more>div{overflow:hidden;min-height:0}
.group.open .more{grid-template-rows:1fr}
.group:not(.open) .more .row{visibility:hidden}
.moreBtn{display:flex;width:100%;align-items:center;gap:6px;padding:11px 18px;border:0;border-top:1px solid var(--line);background:transparent;color:var(--soft);font-weight:600;font-size:13px;text-align:left}
.moreBtn:hover{color:var(--ink);background:var(--row-hover)}
.moreBtn svg{transition:transform .2s var(--ease)}
.group.open .moreBtn svg{transform:rotate(180deg)}

.sw{position:relative;width:40px;height:24px;flex:none;border-radius:12px;border:0;background:var(--line-strong);transition:background .18s}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .2s var(--ease)}
.sw[aria-checked=true]{background:var(--accent)}[data-theme=dark] .sw[aria-checked=true]::after{background:#0F1B1E}.sw[aria-checked=true]::after{transform:translateX(16px)}
.seg{display:flex;background:var(--quiet);border-radius:10px;padding:3px;gap:2px;flex:none}
.seg button{border:0;background:transparent;padding:6px 12px;border-radius:8px;color:var(--soft);font-weight:600;font-size:13px}
.seg button[aria-pressed=true]{background:var(--panel);color:var(--ink);box-shadow:0 0 0 1px var(--line)}
select{appearance:none;border:1px solid var(--line-strong);background:var(--panel);border-radius:9px;padding:6px 28px 6px 11px;font-size:13px;max-width:240px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%2366625a' stroke-width='1.6'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
[data-theme=dark] select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%23aaa59a' stroke-width='1.6'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E")}
.btn{border:1px solid var(--line-strong);background:var(--panel);border-radius:9px;padding:6px 14px;font-weight:600;font-size:13px;flex:none;white-space:nowrap}
.btn:hover{border-color:var(--ink)}
.btn.primary{background:var(--ink);border-color:var(--ink);color:var(--on-ink)}
.btn.quiet{background:var(--quiet);border-color:transparent}
.pair{display:flex;gap:8px;flex:none}
input[type=text]{border:1px solid var(--line-strong);background:var(--panel);border-radius:9px;padding:7px 11px;min-width:0;user-select:text}

.glyph{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font:700 13px var(--sans);color:#fff;margin-top:1px}
.glyph.ok{background:var(--accent);color:var(--accent-ink)}.glyph.warn{background:var(--warn)}.glyph.bad{background:var(--bad)}
.fix{margin-top:3px;font-size:13px;font-weight:600}
.brainRow{padding:8px}.brainRow>.hint{padding:6px 10px 8px}
.pick{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;border:1px solid transparent;background:transparent;border-radius:10px;padding:11px 10px}
.pick:hover:not(:disabled){background:var(--row-hover)}
.pick.on{background:var(--accent-wash);border-color:var(--accent)}
.pick:disabled{cursor:default;opacity:.62}
.radio{flex:none;width:18px;height:18px;margin-top:2px;border-radius:50%;border:2px solid var(--line-strong);background:var(--panel)}
.pick.on .radio{border-color:var(--accent);background:radial-gradient(var(--accent) 0 4px,var(--panel) 5px)}
.tag2{margin-left:8px;font:600 11px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--faint);border:1px solid var(--line-strong);border-radius:6px;padding:1px 6px}

.sess{align-items:flex-start;justify-content:flex-start}
.sdot{flex:none;width:10px;height:10px;border-radius:50%;margin-top:6px;background:var(--faint)}
.sdot.working{background:var(--accent)}.sdot.waiting{background:var(--warn)}
.sname{display:block;border:0;background:transparent;padding:0;font:600 14px var(--sans);text-align:left;color:var(--ink)}
button.sname:hover{text-decoration:underline}
.reveal{border:0;background:transparent;padding:0;font:inherit;color:inherit;text-decoration:underline dotted}
.send{display:flex;gap:8px;margin-top:8px}
.send input{flex:1}

.vocab{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--line)}
.vocab input{flex:1}
.entry{display:grid;grid-template-columns:minmax(0,1.1fr) 24px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 18px;border-top:1px solid var(--line)}
.entry .arrow{color:var(--faint);text-align:center}
.badge{display:inline-block;font:600 11px var(--sans);border-radius:6px;padding:0 7px;margin-right:4px;border:1px solid var(--line-strong);color:var(--soft);background:var(--panel)}
.badge.learned{border-color:var(--accent-edge);background:var(--accent-wash);color:var(--accent-text)}
.x{border:0;background:transparent;color:var(--faint);width:28px;height:28px;border-radius:7px}
.x:hover{background:var(--bad-wash);color:var(--bad)}
kbd{font:600 12px var(--sans);border:1px solid var(--line-strong);border-bottom-width:2px;background:var(--panel);border-radius:6px;padding:1px 7px;margin:0 2px}

#veil{position:fixed;inset:0;background:var(--veil);display:none;place-items:center;z-index:5}
#veil.on{display:grid;animation:fade .18s ease both}
@keyframes fade{from{opacity:0}to{opacity:1}}
#modal{width:min(920px,calc(100vw - 48px));height:min(680px,calc(100vh - 48px));background:var(--panel);border-radius:16px;box-shadow:0 30px 80px -20px rgba(28,27,24,.45);display:grid;grid-template-columns:210px 1fr;overflow:hidden;animation:rise .22s var(--ease) both}
#veil.on.out{animation:fadeout .16s ease both}
@keyframes fadeout{from{opacity:1}to{opacity:0}}
#modal{width:min(820px,calc(100vw - 48px));height:min(540px,calc(100vh - 48px));background:var(--panel);border-radius:16px;box-shadow:var(--modal-shadow);display:grid;grid-template-columns:210px 1fr;overflow:hidden;animation:rise .22s var(--ease) both}
#mnav{background:var(--sunk);border-right:1px solid var(--line);padding:18px 12px;display:flex;flex-direction:column;overflow:auto}
#mnav h4{font:600 11px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:10px 10px 6px}
#mnav .nav{padding:7px 10px}
#mnav .ver{margin-top:auto;padding:10px;color:var(--faint);font-size:12px}
#mbody{padding:26px 32px;overflow:auto;position:relative}
#mbody h1{font-size:26px;margin-bottom:16px}
#mclose{position:absolute;top:14px;right:14px}
.rowwrap{border-top:1px solid var(--line)}
.group>.rowwrap:first-child,.group>.rows>.rowwrap:first-child{border-top:0}
.rowwrap>.row{border-top:0}
.inline{padding:2px 18px 16px}
.wakes{display:flex;flex-direction:column;gap:2px}
.wk{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)}
.wk:first-child{border-top:0}
.chips{display:flex;align-items:center;gap:2px}
.capture{background:var(--accent-wash);border-radius:10px;margin:0 14px 14px;padding:12px 14px}
.kv{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border-top:1px solid var(--line)}
.group>.kv:first-child{border-top:0}
.kv .hint{margin-top:2px}
.kv .inline{margin-top:10px}

@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media (max-width:1020px){.split{grid-template-columns:1fr}}

.hsearch{margin-top:22px}
.hsearch input{width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid var(--line-strong);border-radius:10px;background:var(--panel);font:inherit;margin-bottom:6px}
.hrow{border-top:1px solid var(--line)}.hrow:first-child{border-top:0}
.hhead{display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;border:0;background:transparent;text-align:left;cursor:pointer;font:inherit;color:inherit}
.hhead:hover{background:var(--row-hover)}
.hhead time{flex:none;width:76px;white-space:nowrap;color:var(--faint);font-size:12px}
.htext{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.warnb{background:var(--warn-wash);color:var(--warn)}
.hbody{padding:2px 16px 14px 104px}
.hblock{margin-bottom:10px}.hpre{white-space:pre-wrap;user-select:text;font-size:13px;line-height:1.5}
.hacts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.hline{display:flex;align-items:center}
.hline .hhead{flex:1;min-width:0}
.hcopy{flex:none;margin-right:6px;padding:4px 10px;border:1px solid var(--line-strong);border-radius:8px;background:var(--card);font:600 12px var(--sans);color:var(--soft);cursor:pointer}
.hcopy:hover{color:var(--ink)}
.hmenuwrap{position:relative;flex:none;margin-right:10px}
.hmore{width:28px;height:26px;border:1px solid transparent;border-radius:8px;background:none;color:var(--soft);font:700 16px/1 var(--sans);cursor:pointer}
.hmore:hover,.hmore[aria-expanded=true]{background:var(--sunk);border-color:var(--line-strong);color:var(--ink)}
.hmenu{position:absolute;right:0;top:30px;z-index:5;min-width:170px;padding:4px;border:1px solid var(--line-strong);border-radius:10px;background:var(--panel);box-shadow:0 8px 24px rgba(0,0,0,.18)}
.hitem{display:block;width:100%;padding:7px 10px;border:0;border-radius:7px;background:none;text-align:left;font:500 13px var(--sans);color:var(--ink);cursor:pointer}
.hitem:hover{background:var(--sunk)}
.hitem.off{color:var(--faint)}
.hver{margin-top:10px}
.group:has(.hmenu){overflow:visible}
.voices{display:grid;gap:4px;width:100%}
.voice{display:flex;align-items:center;gap:10px;padding:2px 4px 2px 0;border-radius:9px}
.pickv{flex:1;text-align:left;padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:var(--panel);font:500 13px var(--sans);color:var(--ink);cursor:pointer}
.voice.on .pickv{border-color:var(--accent);background:var(--accent-wash)}
.daycount{color:var(--faint);font-weight:500}
.recs{margin-top:28px;border-top:1px solid var(--line);padding-top:6px}
.rechead{display:flex;align-items:center;gap:12px;width:100%;padding:10px 4px;border:0;background:transparent;font:inherit;color:inherit;cursor:pointer;text-align:left}
.rechead .hint{flex:1}
.rechead[aria-expanded=true] svg{transform:rotate(180deg)}
.insight{display:flex;justify-content:space-between;gap:12px;padding:6px 0;color:var(--soft)}
.chipx{display:inline-flex;align-items:center;gap:4px}

/* Its own voice: editorial type, hairline rules instead of cards, one ink-blue accent. */
body{font-size:14px}
h1{font:400 38px/1.08 var(--serif);letter-spacing:-.02em;margin:0 0 6px}
h1 em{font-style:italic;color:var(--accent-text)}
.lede{font:italic 400 17px/1.5 var(--serif);color:var(--soft);margin:0 0 26px;max-width:58ch}
.dateline{font:600 11px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:0 0 10px}
h2{display:flex;align-items:baseline;gap:10px;font:600 11px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--soft);margin:38px 0 12px}
#page{counter-reset:sec}
h2::before{counter-increment:sec;content:counter(sec,decimal-leading-zero);color:var(--faint);font-variant-numeric:tabular-nums}
#panel{border-radius:6px;box-shadow:none}
.nav{border-radius:6px;position:relative}
.nav[aria-current=page]{background:transparent;box-shadow:none;color:var(--ink);font-weight:600}
.nav[aria-current=page]::before{content:"";position:absolute;left:-12px;top:9px;bottom:9px;width:2px;background:var(--accent)}
.state{background:transparent;border-radius:6px}
.group,.log,.stats{background:transparent;border:0;border-radius:0;border-top:1px solid var(--line-strong);border-bottom:1px solid var(--line);overflow:visible}
.group>.row,.rowwrap>.row,.log .li,.stat{padding-left:2px;padding-right:2px}
.group.open,.group{overflow:visible}
.stats{padding:0 2px}
.stat b{font-variant-numeric:tabular-nums}
.banner{background:transparent;color:var(--ink);border-radius:0;border-left:3px solid var(--accent);padding:4px 0 4px 18px;margin:24px 0 8px}
.banner.warn{background:transparent;border-left-color:var(--warn)}
.banner h3{font:400 22px/1.25 var(--serif)}
.banner p,.banner.warn p{color:var(--soft)}
.banner .btn{background:transparent;color:var(--ink);border:1px solid var(--line-strong)}
.banner .btn:hover{border-color:var(--ink)}
.pill{border-radius:6px;font-weight:500}
.btn{border-radius:6px}
.seg,.seg button{border-radius:6px}
.sidecard{border-radius:6px}
.log time,.hrow time{font-variant-numeric:tabular-nums}
.memedit{width:100%;min-height:72px;border:1px solid var(--line-strong);background:var(--panel);border-radius:9px;padding:8px 11px;font:inherit;color:inherit;resize:vertical;user-select:text}
.memacts{display:flex;gap:6px;flex:none;align-items:center}.memedit+.memacts{margin-top:8px}
.membar>.seg{margin:0 18px 10px;flex-wrap:wrap}.memtools{display:flex;gap:8px;flex-wrap:wrap;padding:0 18px 10px}.memstatus{padding:0 18px 12px}
.btn[aria-pressed=true]{background:var(--accent-wash);border-color:var(--accent-edge);color:var(--accent-text)}
:focus-visible{outline-color:var(--focus)}
`;
