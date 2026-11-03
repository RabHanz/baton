// Old path of scripts/tessaya/sync-status.mjs; kept so existing callers keep working.
import { spawnSync } from "node:child_process";
const target = new URL("../tessaya/sync-status.mjs", import.meta.url).pathname;
process.exit(spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);
