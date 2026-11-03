// Old path of scripts/tessaya/status-file.mjs; kept so existing callers keep working.
import * as NodeChildProcess from "node:child_process";
const target = new URL("../tessaya/status-file.mjs", import.meta.url).pathname;
process.exit(NodeChildProcess.spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);
