// Old path of scripts/tessaya/clip-eval.mjs; kept so existing callers keep working.
import { spawnSync } from "node:child_process";
const target = new URL("../tessaya/clip-eval.mjs", import.meta.url).pathname;
process.exit(spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);
