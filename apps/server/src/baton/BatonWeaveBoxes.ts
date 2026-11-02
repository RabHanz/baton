// @effect-diagnostics nodeBuiltinImport:off
/**
 * The machines a weave may reach (D149): this one always, and the hosts in `BATON_WEAVE_HOSTS`
 * (off unless set) over ssh with the key and herdr path given there. A remote box is the same
 * Herdr adapter over an ssh command, so the rules for delivery are the same everywhere.
 */
import * as NodeChildProcess from "node:child_process";

import { parseWeaveHosts, sshHerdr, type WeaveHost } from "@t3tools/baton-shared/weaveBoxes";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AdoptedRuntimeAdapter } from "./AdoptedSessionService.ts";
import { HerdrCli, make as makeHerdrAdapter, type HerdrCommandResult } from "./HerdrAdapterLive.ts";

export interface WeaveBox {
  readonly name: string;
  readonly adapter: AdoptedRuntimeAdapter["Service"];
}

export class BatonWeaveBoxes extends Context.Service<BatonWeaveBoxes, ReadonlyArray<WeaveBox>>()(
  "t3/baton/BatonWeaveBoxes",
) {}

const SSH_TIMEOUT_MS = 20_000;

const sshCli = (host: WeaveHost): HerdrCli["Service"] => ({
  run: (args) =>
    Effect.callback<HerdrCommandResult>((resume) => {
      const cmd = sshHerdr(host, args);
      const child = NodeChildProcess.execFile(
        cmd.file,
        [...cmd.args],
        { timeout: SSH_TIMEOUT_MS, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code = (error as NodeJS.ErrnoException | null)?.code;
          resume(
            Effect.succeed({
              stdout: stdout ?? "",
              stderr: stderr ?? "",
              exitCode: error === null ? 0 : 1,
              notInstalled: code === "ENOENT",
            }),
          );
        },
      );
      return Effect.sync(() => {
        child.kill();
      });
    }),
});

export const layer = Layer.effect(
  BatonWeaveBoxes,
  Effect.gen(function* () {
    const local = yield* AdoptedRuntimeAdapter;
    const { hosts } = parseWeaveHosts(process.env["BATON_WEAVE_HOSTS"]);
    const remote = yield* Effect.forEach(hosts, (host) =>
      Effect.map(
        makeHerdrAdapter.pipe(Effect.provideService(HerdrCli, sshCli(host))),
        (adapter): WeaveBox => ({ name: host.name, adapter }),
      ),
    );
    return [{ name: "here", adapter: local }, ...remote] as ReadonlyArray<WeaveBox>;
  }),
);
