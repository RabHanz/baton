// Run upstream's agent-session import (`agentSessions.import`) for one project, as a paired
// client: the RPC is reachable only from the web client's onboarding wizard otherwise (D87).
//   node agent-session-import.mjs <pair-url-file> <projectId> [workspaceRoot]
//   node agent-session-import.mjs <pair-url-file> scan      (lists candidates); Playwright from $PLAYWRIGHT_DIR
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`);
const { chromium } = require("playwright");

const [pairFile, projectId, workspaceRoot] = process.argv.slice(2);
const [tag, payload] =
  projectId === "scan"
    ? ["agentSessions.scan", {}]
    : [
        "agentSessions.import",
        { projectId, ...(workspaceRoot ? { expectedWorkspaceRoot: workspaceRoot } : {}) },
      ];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(NodeFS.readFileSync(pairFile, "utf8").trim(), {
  waitUntil: "domcontentloaded",
  timeout: 120_000,
});
// Pairing is done once the app leaves /pair (slow over a tunnel).
await page
  .waitForURL((url) => !url.pathname.startsWith("/pair"), { timeout: 120_000 })
  .catch(() => {});
await page.waitForTimeout(4000);
if (process.env.IMPORT_SHOT) await page.screenshot({ path: process.env.IMPORT_SHOT });
const result = await page.evaluate(
  ({ tag, payload }) =>
    new Promise((resolve) => {
      const ws = new WebSocket(
        `${location.origin.replace(/^http/, "ws")}/ws?orchestrationProtocol=2`,
      );
      const seen = [];
      const timer = setTimeout(() => resolve({ timeout: true, seen }), 300_000);
      ws.onopen = () =>
        ws.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] }));
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message._tag === "Ping") return ws.send(JSON.stringify({ _tag: "Pong" }));
        seen.push(message);
        if (message._tag === "Exit" || message._tag === "Defect") {
          clearTimeout(timer);
          resolve(message);
        }
      };
      ws.onclose = (event) => resolve({ closed: event.code, reason: event.reason, seen });
    }),
  { tag, payload },
);
console.log(JSON.stringify(result));
await browser.close();
