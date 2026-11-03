// Puts a live (mirrored) thread back on its own session and removes the twin a provider switch started.
//   T3_URL=http://127.0.0.1:3773 T3_TOKEN=<access token> node scripts/tessaya/retire-handoff.mjs \
//     --thread baton-live4:cc828d1b-<full id> [--twin baton-live4:a262f02b-01b1-4368-bf2d-18fd0c22dec5] [--dry-run] [--caught-up]
// Token: either T3_TOKEN (an access token with orchestration:operate), or T3_PAIRING_TOKEN (a one-time token from
// `node apps/server/src/bin.ts pair --base-dir <T3 home> --ttl 10m`), which is exchanged for one here.
// --dry-run only reads both threads and prints what would happen. The real call needs --caught-up.

import * as NodeModule from "node:module";
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const base = (process.env.T3_URL ?? "http://127.0.0.1:3773").replace(/\/$/, "");
const thread = option("--thread", process.env.THREAD_ID ?? "");
const twin = option("--twin", "baton-live4:a262f02b-01b1-4368-bf2d-18fd0c22dec5");
const dryRun = flag("--dry-run");
if (!/^baton-live\d*:/.test(thread) || thread.length < 30) {
  console.error("Pass the full main thread id with --thread baton-live4:<session uuid>.");
  process.exit(2);
}

let access = process.env.T3_TOKEN ?? "";
if (access === "" && (process.env.T3_PAIRING_TOKEN ?? "") !== "") {
  const exchanged = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: process.env.T3_PAIRING_TOKEN,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: "orchestration:read orchestration:operate",
      client_label: "retire-handoff",
    }),
  });
  access = (await exchanged.json()).access_token ?? "";
}
if (access === "") {
  console.error("Set T3_TOKEN, or T3_PAIRING_TOKEN to exchange.");
  process.exit(2);
}

const root = NodePath.resolve(import.meta.dirname, "..", "..");
const wsDir = (await import("node:fs")).readdirSync(NodePath.join(root, "node_modules", ".pnpm")).find((d) => d.startsWith("ws@8"));
const { WebSocket } = NodeModule.createRequire(
  NodePath.join(root, "node_modules", ".pnpm", wsDir, "node_modules/"),
)("ws");
const socket = new WebSocket(`${base.replace("http", "ws")}/ws?orchestrationProtocol=2`, {
  headers: { authorization: `Bearer ${access}` },
});
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});
let nextId = 0;
const pending = new Map();
socket.on("message", (data) => {
  const message = JSON.parse(String(data));
  if (message._tag === "Ping") return socket.send(JSON.stringify({ _tag: "Pong" }));
  if (message._tag === "Exit") pending.get(message.requestId)?.(message.exit);
});
const rpc = (tag, payload) =>
  new Promise((resolve, reject) => {
    const id = String(++nextId);
    const timer = setTimeout(() => reject(new Error(`${tag} timed out`)), 120_000);
    pending.set(id, (exit) => (clearTimeout(timer), resolve(exit)));
    socket.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
  });
const read = async (threadId) => {
  const exit = await rpc("orchestration.getThreadProjection", { threadId });
  const projection = exit?._tag === "Success" ? exit.value : null;
  return {
    found: projection !== null,
    instance: projection?.thread?.providerInstanceId ?? null,
    working: (projection?.runs ?? []).some((run) => ["running", "queued", "starting"].includes(run.status)),
    runs: projection?.runs?.length ?? 0,
  };
};

try {
  const main = await read(thread);
  const other = await read(twin);
  console.log(`main thread ${thread}: ${JSON.stringify(main)}`);
  console.log(`twin thread ${twin}: ${JSON.stringify(other)}`);
  const problems = [];
  if (!main.found) problems.push("the main thread does not exist");
  else if (main.instance === "baton-live") problems.push("the main thread is already on its live session");
  if (main.working) problems.push("the main thread is working");
  if (!other.found) problems.push("the twin's mirror thread does not exist");
  else if (other.instance !== "baton-live") problems.push("the twin's thread is not a live mirror");
  if (dryRun) {
    console.log(
      problems.length > 0
        ? `DRY RUN: would be refused: ${problems.join("; ")}`
        : `DRY RUN: would switch ${thread} back to its live session, archive then delete ${twin}, and write an undo list. Nothing was changed.`,
    );
    process.exit(problems.length > 0 ? 1 : 0);
  }
  const exit = await rpc("baton.sessions.retirehandoff", {
    threadId: thread,
    twinThreadId: twin,
    confirm: `retire-handoff:${thread}`,
    caughtUp: flag("--caught-up"),
  });
  const result = exit?._tag === "Success" ? exit.value : null;
  console.log(JSON.stringify(result ?? exit, null, 2));
  if (result?.undoFile) console.log(`undo list: ${result.undoFile}`);
  process.exit(result?.state === "retired" ? 0 : 1);
} finally {
  socket.close();
}
