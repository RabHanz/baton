/* oxlint-disable t3code/no-low-value-comments -- Baton file */
/**
 * The phone page's files, served by BatonTessayaRoutes at /tessaya. Plain HTML and one script: no build step, nothing
 * fetched from elsewhere, text always set with textContent. The icons are the web app's own (/icon-192.png and friends).
 */

export const MANIFEST = JSON.stringify({
  id: "/tessaya/",
  name: "Tessaya",
  short_name: "Tessaya",
  start_url: "/tessaya/",
  scope: "/tessaya/",
  display: "standalone",
  background_color: "#14505A",
  theme_color: "#14505A",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});

// A fetch handler is what makes the page installable; it caches nothing, so what he sees is always the server's.
export const SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
`;

export const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#14505A">
<title>Tessaya</title>
<link rel="manifest" href="/tessaya/manifest.webmanifest">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
:root{--bg:#ebe9e4;--panel:#f8f7f4;--ink:#17181b;--soft:#565961;--line:#dedbd4;--accent:#14505A;--on:#fff;--bad:#9b2c2c}
@media (prefers-color-scheme:dark){:root{--bg:#111214;--panel:#1a1b1f;--ink:#ebebe8;--soft:#a6a8b0;--line:#2a2c32;--accent:#5FB3B3;--on:#0F1B1E;--bad:#e08a8a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,sans-serif;padding:0 16px calc(96px + env(safe-area-inset-bottom))}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 0 6px}
h1{font-size:20px;margin:0}
nav{display:flex;gap:6px;overflow-x:auto;padding:6px 0 10px}
nav button{flex:none;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:22px;background:var(--panel);color:var(--ink);font:inherit}
nav button[aria-selected=true]{background:var(--accent);color:var(--on);border-color:var(--accent)}
.badge{display:inline-block;min-width:20px;margin-left:6px;padding:0 6px;border-radius:10px;background:var(--bad);color:#fff;font-size:13px;text-align:center}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px}
.card h2{font-size:16px;margin:0 0 2px}
.soft{color:var(--soft);font-size:14px;margin:2px 0}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
button.act{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--accent);background:transparent;color:var(--accent);font:inherit}
button.act.primary{background:var(--accent);color:var(--on)}
.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--panel);border-top:1px solid var(--line);display:flex;gap:8px}
.bar input{flex:1;min-height:48px;border-radius:24px;border:1px solid var(--line);padding:0 16px;background:var(--bg);color:var(--ink);font:inherit}
.bar button{min-width:48px;min-height:48px;border-radius:24px;border:1px solid var(--accent);background:var(--accent);color:var(--on);font:inherit;padding:0 14px;touch-action:none}
.bar button.rec{background:var(--bad);border-color:var(--bad)}
#say{margin:0 0 10px;white-space:pre-wrap}
</style>
</head>
<body>
<header><h1>Tessaya</h1><span class="soft" id="stamp"></span></header>
<nav role="tablist" aria-label="Sections" id="tabs"></nav>
<main id="view" aria-live="polite"></main>
<div class="bar">
<input id="ask" type="text" enterkeyhint="send" placeholder="Ask or tell Tessaya" aria-label="Ask or tell Tessaya" autocomplete="off">
<button id="send" type="button" aria-label="Send">Send</button>
<button id="talk" type="button" aria-label="Hold to talk">Talk</button>
</div>
<script src="/tessaya/app.js"></script>
</body>
</html>
`;

export const SCRIPT = `"use strict";
(function () {
  var TABS = [["needs", "Needs me"], ["approvals", "Approvals"], ["now", "Now"], ["jobs", "Jobs"], ["weave", "Weave"]];
  var tab = "needs", state = null, said = "", denied = false;
  var view = document.getElementById("view"), tabs = document.getElementById("tabs");
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function api(method, path, body, raw) {
    var init = { method: method, credentials: "same-origin", headers: {} };
    if (raw) { init.body = body; init.headers["content-type"] = "audio/wav"; }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; }
    return fetch("/tessaya/api/" + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; });
    });
  }
  function badge(n) {
    document.title = n > 0 ? "(" + n + ") Tessaya" : "Tessaya";
    try { if (navigator.setAppBadge) { n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } } catch (e) {}
  }
  function drawTabs() {
    tabs.textContent = "";
    TABS.forEach(function (t) {
      var b = el("button", "", t[1]); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(t[0] === tab));
      if (t[0] === "needs" && state && state.badge > 0) b.appendChild(el("span", "badge", String(state.badge)));
      b.onclick = function () { tab = t[0]; draw(); };
      tabs.appendChild(b);
    });
  }
  function act(label, cls, fn) { var b = el("button", "act " + (cls || ""), label); b.type = "button"; b.onclick = function () { b.disabled = true; fn().then(function (j) { if (j && j.message) said = j.message; load(); }); }; return b; }
  function draw() {
    drawTabs(); view.textContent = "";
    if (denied) { var c = el("div", "card"); c.appendChild(el("h2", "", "This phone is not paired")); c.appendChild(el("p", "soft", "Open this server's normal address on this phone and pair it there first. Then come back to /tessaya.")); view.appendChild(c); return; }
    if (said) view.appendChild(el("p", "card", said)).id = "say";
    if (!state) { view.appendChild(el("p", "soft", "Loading")); return; }
    if (tab === "needs") {
      if (!state.needs.length) view.appendChild(el("p", "soft", "Nothing needs you."));
      state.needs.forEach(function (n) { var c = el("div", "card"); c.appendChild(el("h2", "", n.title)); c.appendChild(el("p", "soft", n.why)); view.appendChild(c); });
    } else if (tab === "approvals") {
      if (!state.approvals.length) view.appendChild(el("p", "soft", "Nothing is waiting for your yes."));
      state.approvals.forEach(function (a) {
        var c = el("div", "card"); c.appendChild(el("h2", "", a.title)); c.appendChild(el("p", "", a.action)); c.appendChild(el("p", "soft", "Would use: " + a.permission));
        if (a.answerable) {
          var r = el("div", "row");
          r.appendChild(act("Approve", "primary", function () { return api("POST", "approvals/" + encodeURIComponent(a.id), { decision: "approve", action: a.action }); }));
          r.appendChild(act("Deny", "", function () { return api("POST", "approvals/" + encodeURIComponent(a.id), { decision: "deny", action: a.action }); }));
          c.appendChild(r);
        } else c.appendChild(el("p", "soft", "Only you can answer this one, in its thread."));
        view.appendChild(c);
      });
    } else if (tab === "now") {
      state.now.forEach(function (l) { view.appendChild(el("p", "card", l)); });
    } else if (tab === "jobs") {
      if (!state.jobs.length) view.appendChild(el("p", "soft", "No jobs."));
      state.jobs.forEach(function (j) {
        var c = el("div", "card"); c.appendChild(el("h2", "", j.title)); c.appendChild(el("p", "soft", j.status));
        var r = el("div", "row");
        if (j.canStop) r.appendChild(act("Stop", "", function () { return api("POST", "jobs/" + encodeURIComponent(j.id) + "/stop"); }));
        if (j.canRetry) r.appendChild(act("Retry", "primary", function () { return api("POST", "jobs/" + encodeURIComponent(j.id) + "/retry"); }));
        if (r.children.length) c.appendChild(r);
        view.appendChild(c);
      });
    } else if (tab === "weave") {
      if (!state.weaves.length) view.appendChild(el("p", "soft", "Nothing between sessions."));
      state.weaves.forEach(function (w) { var c = el("div", "card"); c.appendChild(el("p", "", w.line)); c.appendChild(el("p", "soft", w.status)); view.appendChild(c); });
    }
  }
  function load() {
    return api("GET", "state").then(function (j) {
      denied = j.status === 401 || j.status === 403;
      if (j.status === 200) { state = j; badge(j.badge); document.getElementById("stamp").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
      draw();
    }).catch(function () { said = "The server did not answer."; draw(); });
  }
  function send(text) {
    if (!text) return;
    said = "Sending"; draw();
    api("POST", "say", { text: text }).then(function (j) { said = j.reply || j.message || ""; draw(); load(); });
  }
  document.getElementById("send").onclick = function () { var i = document.getElementById("ask"); var t = i.value.trim(); i.value = ""; send(t); };
  document.getElementById("ask").onkeydown = function (e) { if (e.key === "Enter") document.getElementById("send").click(); };

  // Push to talk: record while held, make a 16 kHz mono WAV here, send it; the server transcribes and answers.
  function wavOf(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var Ctx = window.AudioContext || window.webkitAudioContext; var ac = new Ctx();
      return ac.decodeAudioData(buf).then(function (audio) {
        ac.close();
        var off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * 16000)), 16000);
        var src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
        return off.startRendering();
      });
    }).then(function (r) {
      var pcm = r.getChannelData(0), out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
      function s(o, t) { for (var i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); }
      s(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); s(8, "WAVE"); s(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
      out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); s(36, "data"); out.setUint32(40, pcm.length * 2, true);
      for (var i = 0; i < pcm.length; i++) { var v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
      return new Blob([out], { type: "audio/wav" });
    });
  }
  var talk = document.getElementById("talk"), rec = null, chunks = [];
  function stopTalk() { if (rec && rec.state === "recording") rec.stop(); }
  talk.onpointerdown = function (e) {
    e.preventDefault();
    if (!navigator.mediaDevices || !window.MediaRecorder) { said = "This browser cannot record. Type instead."; draw(); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      chunks = []; rec = new MediaRecorder(stream); talk.classList.add("rec"); talk.textContent = "Listening";
      rec.ondataavailable = function (ev) { if (ev.data.size) chunks.push(ev.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); }); talk.classList.remove("rec"); talk.textContent = "Talk";
        said = "Listening done. Working on it"; draw();
        wavOf(new Blob(chunks)).then(function (wav) { return api("POST", "voice", wav, true); }).then(function (j) {
          said = j.heard ? "You said: " + j.heard + "\\n\\n" + (j.reply || "") : (j.message || "Nothing came back.");
          draw(); load();
        }).catch(function () { said = "That recording could not be sent."; draw(); });
      };
      rec.start();
    }).catch(function () { said = "The microphone is not allowed for this page."; draw(); });
  };
  talk.onpointerup = stopTalk; talk.onpointercancel = stopTalk; talk.onpointerleave = stopTalk;

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/tessaya/sw.js").catch(function () {});
  load();
  // Polling, not push: every 20 seconds while the page is in view.
  setInterval(function () { if (!document.hidden) load(); }, 20000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
`;
