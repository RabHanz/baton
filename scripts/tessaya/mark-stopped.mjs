// Marks a session "stopped on purpose" so the auto-resume watchdog leaves it stopped, for a kill done from outside:
//   node scripts/tessaya/mark-stopped.mjs <session id> [data dir]   (data dir defaults to ~/.t3/userdata)
// The server reads the file again on its next pass (within a minute).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const [id, dir = NodePath.join(NodeOS.homedir(), ".t3", "userdata")] = process.argv.slice(2);
if (!id) {
  console.error("usage: node scripts/tessaya/mark-stopped.mjs <session id> [data dir]");
  process.exit(2);
}
const file = NodePath.join(dir, "baton-autoresume.json");
let state = { stopped: [], resumes: {}, seenLive: {} };
try {
  state = { ...state, ...JSON.parse(NodeFS.readFileSync(file, "utf8")) };
} catch {
  // first mark
}
if (!state.stopped.includes(id)) state.stopped.push(id);
NodeFS.writeFileSync(file, JSON.stringify(state));
console.log(`${id} will stay stopped (${file})`);
