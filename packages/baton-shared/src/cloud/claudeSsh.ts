/**
 * Claude over the central dispatch shell (transport 3, the fleet's advanced one): the VentureOS
 * `cloud-dispatch-shell` contract in docs/baton/CLOUD_DISPATCH.md. One key per caller reaches only the
 * allowed subcommands; approve and deny need a second, approver key. Arguments are an argument list,
 * values are restricted to characters that need no quoting, and the brief travels on stdin.
 */
import { jsonLines, jsonObject, requestFrom, safeArg, safeWords, usageFrom } from "./parse.ts";
import { BRIEF_MAX, type CloudProvider, type CloudRequest, type Exec, type ExecResult, type Outcome, type Usage } from "./types.ts";

export interface SshSettings {
  readonly host: string;
  readonly user: string;
  /** Paths of key files; never the keys. */
  readonly machineKey: string;
  readonly approverKey: string;
  readonly ssh?: string;
  readonly accounts?: ReadonlyArray<string>;
}

const TIMEOUT_MS = 30_000;

const fail = <T>(error: string): Outcome<T> => ({ ok: false, error });

/** Plain words for a failed run. Never includes a key path's contents, only that something failed. */
export const sshProblem = (r: ExecResult, key: "machine" | "approver"): string => {
  if (r.missing) return "ssh is not installed on this computer. Install the OpenSSH client, or use the default way of running cloud tasks.";
  if (r.timedOut) return "The cloud dispatch computer did not answer in time.";
  const err = r.stderr.toLowerCase();
  if (err.includes("permission denied")) return key === "approver" ? "The approval key was not accepted." : "The cloud dispatch key was not accepted.";
  if (err.includes("no such file") || err.includes("identity file")) return key === "approver" ? "The approval key file was not found." : "The cloud dispatch key file was not found.";
  if (r.code === 255 || err.includes("could not resolve") || err.includes("connection")) return "The cloud dispatch computer could not be reached.";
  const said = jsonObject(r.stdout);
  const e = said?.["error"];
  return typeof e === "string" && e !== "" ? e.slice(0, 200) : "The cloud dispatch computer refused that.";
};

export const claudeSsh = (s: SshSettings, exec: Exec): CloudProvider => {
  /** Account names the shell reported last; the card offers these when none are configured. */
  let known: ReadonlyArray<string> = [];
  const ready = s.host !== "" && s.user !== "" && s.machineKey !== "";
  const call = async (
    key: "machine" | "approver",
    sub: ReadonlyArray<string>,
    stdin?: string,
  ): Promise<Outcome<ExecResult>> => {
    const keyFile = key === "machine" ? s.machineKey : s.approverKey;
    if (!ready) return fail("Cloud dispatch over a shared computer is not set up on this computer.");
    if (keyFile === "") return fail("The approval key is not set. Add it under Cloud, Advanced.");
    let args: string[];
    try {
      args = [
        "-i", keyFile, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=10",
        `${safeArg(s.user, "The user name")}@${safeArg(s.host, "The host name")}`,
        "cloud-dispatch", ...sub,
      ];
    } catch (error) {
      return fail(error instanceof Error ? error.message : "That cannot be sent safely.");
    }
    const r = await exec(s.ssh ?? "ssh", args, { ...(stdin === undefined ? {} : { stdin }), timeoutMs: TIMEOUT_MS });
    return r.code === 0 ? { ok: true, value: r } : fail(sshProblem(r, key));
  };
  const one = (r: ExecResult): Outcome<CloudRequest> => {
    const o = jsonObject(r.stdout);
    if (o === null) return fail("The cloud dispatch computer sent something unreadable.");
    if (typeof o["error"] === "string") return fail(o["error"].slice(0, 200));
    return { ok: true, value: requestFrom("claude", o) };
  };
  return {
    id: "claude",
    transport: "ssh",
    label: "Claude",
    driver: "claudeAgent",
    capabilities: { resultKind: "pr", cancel: true, usage: true, diff: false, apply: false },
    approval: "remote",
    setup: () => (ready ? { state: "ready" } : { state: "not-set-up", why: "No shared computer is chosen.", needs: "A host, a user and a key file under Cloud, Advanced." }),
    detect: async () => ({
      installed: ready,
      signedIn: ready,
      identity: null,
      line: ready ? "Claude runs on the shared cloud computer." : "Claude on a shared cloud computer is not set up.",
      signInCommand: null,
    }),
    accounts: () => s.accounts ?? known,
    dispatch: async (input) => {
      const brief = input.brief.trim();
      if (brief === "") return fail("There is nothing to send.");
      if (brief.length > BRIEF_MAX) return fail(`A cloud brief is at most ${BRIEF_MAX} characters.`);
      let sub: string[];
      try {
        sub = ["dispatch", "--repo", safeArg(input.repo, "The repository"), "--branch", safeArg(input.branch, "The branch"), "--task-file", "-"];
      } catch (error) {
        return fail(error instanceof Error ? error.message : "That cannot be sent safely.");
      }
      if (input.label !== undefined) sub.push("--label", safeWords(input.label, 60));
      if (input.expectedUsage !== undefined) sub.push("--usage", String(input.expectedUsage));
      const r = await call("machine", sub, brief);
      if (!r.ok) return r;
      const made = one(r.value);
      return made.ok ? { ok: true, value: { ...made.value, state: "awaiting-director" as const, fromWeb: input.fromWeb === true, task: made.value.task ?? brief.split("\n")[0]!.slice(0, 140) } } : made;
    },
    status: async (id) => {
      const r = await call("machine", ["status", safeWords(id, 40)]);
      return r.ok ? one(r.value) : r;
    },
    list: async (f) => {
      const r = await call("machine", ["list", ...(f.mine === true ? ["--mine"] : []), ...(f.label === undefined ? [] : ["--label", safeWords(f.label, 60)])]);
      return r.ok ? { ok: true, value: jsonLines(r.value.stdout).filter((o) => o["error"] === undefined).map((o) => requestFrom("claude", o)) } : r;
    },
    cancel: async (id) => {
      const r = await call("machine", ["cancel", safeWords(id, 40)]);
      return r.ok ? { ok: true, value: null } : r;
    },
    usage: async () => {
      const r = await call("machine", ["usage"]);
      if (!r.ok) return r;
      const o = jsonObject(r.value.stdout);
      const rows = Array.isArray(o?.["accounts"]) ? (o!["accounts"] as unknown[]) : jsonLines(r.value.stdout);
      const list: Usage[] = rows.flatMap((x) => {
        const u = typeof x === "object" && x !== null ? usageFrom("claude", x as Record<string, unknown>) : null;
        return u === null ? [] : [u];
      });
      known = list.map((u) => u.account);
      return { ok: true, value: list };
    },
    approve: async (id, account, answerRef) => {
      const r = await call("approver", ["approve", safeWords(id, 40), "--account", safeArg(account, "The account"), "--answer-ref", safeWords(answerRef, 60)]);
      return r.ok ? one(r.value) : r;
    },
    deny: async (id, reason) => {
      const r = await call("approver", ["deny", safeWords(id, 40), "--reason", safeWords(reason, 80)]);
      return r.ok ? { ok: true, value: null } : r;
    },
  };
};
