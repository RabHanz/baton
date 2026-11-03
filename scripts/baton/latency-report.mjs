// Old path of scripts/tessaya/latency-report.mjs; kept so existing callers keep working.
import * as NodeChildProcess from "node:child_process";
const target = new URL("../tessaya/latency-report.mjs", import.meta.url).pathname;
process.exit(NodeChildProcess.spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);
