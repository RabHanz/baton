// Old path of scripts/tessaya/span-times.mjs; kept so existing callers keep working.
import { spawnSync } from "node:child_process";
const target = new URL("../tessaya/span-times.mjs", import.meta.url).pathname;
process.exit(spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);
