// Run upstream's agent-session import (`agentSessions.import`) for one project, as a paired
// client: the RPC is reachable only from the web client's onboarding wizard otherwise (D87).
//   node agent-session-import.mjs <pair-url-file> <projectId> [workspaceRoot]
// Playwright comes from $PLAYWRIGHT_DIR.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`);
const { chromium } = require("playwright");

const [pairFile, projectId, workspaceRoot] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(NodeFS.readFileSync(pairFile, "utf8").trim(), { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const result = await page.evaluate(
  ({ projectId, workspaceRoot }) =>
    new Promise((resolve) => {
      const ws = new WebSocket(
        `${location.origin.replace(/^http/, "ws")}/ws?orchestrationProtocol=2`,
      );
      const seen = [];
      const timer = setTimeout(() => resolve({ timeout: true, seen }), 300_000);
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            _tag: "Request",
            id: "1",
            tag: "agentSessions.import",
            payload: {
              projectId,
              ...(workspaceRoot ? { expectedWorkspaceRoot: workspaceRoot } : {}),
            },
            headers: [],
          }),
        );
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
  { projectId, workspaceRoot },
);
console.log(JSON.stringify(result));
await browser.close();
