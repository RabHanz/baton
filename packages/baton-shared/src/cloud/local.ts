/**
 * The default way (transport 1): Tessaya runs the harness's own program on this computer, with this
 * computer's own login. No server, no keys, nothing to set up. A request waits in a small local list
 * until he approves it; only then is anything started. Each harness says how it is started and how its
 * state is read; everything else is shared here.
 */
import { BRIEF_MAX, type CloudProvider, type CloudRequest, type Detection, type Exec, type Outcome, type ProviderId, type Usage } from "./types.ts";

export interface PendingStore {
  readonly load: () => ReadonlyArray<CloudRequest>;
  readonly save: (list: ReadonlyArray<CloudRequest>) => void;
  /** A new id, unique in this list. */
  readonly nextId: () => string;
}

/** The briefs of waiting requests, kept apart from the list so the list never holds a long text. */
export interface BriefStore {
  readonly get: (id: string) => string | null;
  readonly put: (id: string, brief: string) => void;
  readonly drop: (id: string) => void;
}

export interface LocalHarness {
  readonly id: ProviderId;
  readonly label: string;
  readonly driver: string;
  readonly resultKind: "pr" | "diff" | "branch";
  readonly canCancel: boolean;
  readonly diff?: boolean;
  /** What this computer has: installed, signed in, as whom. */
  readonly detect: () => Promise<Detection>;
  readonly accounts: () => ReadonlyArray<string>;
  /** Starts the work for an approved request; the link or id the harness printed, or why it could not. */
  readonly start: (request: CloudRequest, brief: string, account: string) => Promise<Outcome<{ readonly link: string | null; readonly taskId: string | null }>>;
  readonly refresh?: (request: CloudRequest) => Promise<Outcome<CloudRequest>>;
  readonly usage: () => Promise<Outcome<ReadonlyArray<Usage>>>;
  readonly diffOf?: (request: CloudRequest) => Promise<Outcome<string>>;
  readonly applyOf?: (request: CloudRequest) => Promise<Outcome<string>>;
}

const fail = <T>(error: string): Outcome<T> => ({ ok: false, error });

export const localProvider = (h: LocalHarness, store: PendingStore, briefs: BriefStore): CloudProvider => {
  const find = (id: string) => store.load().find((r) => r.id === id);
  const replace = (r: CloudRequest) => store.save(store.load().map((x) => (x.id === r.id ? r : x)));
  return {
    id: h.id,
    transport: "local",
    label: h.label,
    driver: h.driver,
    capabilities: { resultKind: h.resultKind, cancel: h.canCancel, usage: true, diff: h.diff === true, apply: h.diff === true },
    approval: "local",
    setup: () => ({ state: "ready" }),
    detect: h.detect,
    accounts: h.accounts,
    dispatch: async (input) => {
      const brief = input.brief.trim();
      if (brief === "") return fail("There is nothing to send.");
      if (brief.length > BRIEF_MAX) return fail(`A cloud brief is at most ${BRIEF_MAX} characters.`);
      const request: CloudRequest = {
        provider: h.id, id: store.nextId(), state: "awaiting-director", task: brief.split("\n")[0]!.slice(0, 140),
        repo: input.repo, branch: input.branch, caller: "tessaya", label: input.label ?? null, account: null,
        sessionLink: null, result: null, expectedUsage: input.expectedUsage ?? null, weeklyBefore: null,
        weeklyAfter: null, pointsUsed: null, fromWeb: input.fromWeb === true,
      };
      briefs.put(request.id, brief);
      store.save([...store.load(), request]);
      return { ok: true, value: request };
    },
    status: async (id) => {
      const r = find(id);
      if (r === undefined) return fail("There is no such cloud request.");
      if (h.refresh !== undefined && (r.state === "running" || r.state === "approved")) {
        const fresh = await h.refresh(r);
        if (fresh.ok) {
          replace(fresh.value);
          return fresh;
        }
      }
      return { ok: true, value: r };
    },
    list: async (f) => ({
      ok: true,
      value: store.load().filter((r) => f.label === undefined || f.mine !== true || r.label === f.label),
    }),
    cancel: async (id) => {
      const r = find(id);
      if (r === undefined) return fail("There is no such cloud request.");
      if (r.state !== "awaiting-director") {
        return fail(h.canCancel ? "Only a request that is still waiting can be withdrawn here." : `${h.label} cannot stop a task that has started. Open its link to stop it.`);
      }
      briefs.drop(id);
      replace({ ...r, state: "cancelled" });
      return { ok: true, value: null };
    },
    usage: h.usage,
    approve: async (id, account, _answerRef) => {
      const r = find(id);
      if (r === undefined) return fail("There is no such cloud request.");
      if (r.state !== "awaiting-director") return fail("That request is no longer waiting for an answer.");
      if (!h.accounts().includes(account)) return fail("That is not one of the accounts on this computer.");
      const brief = briefs.get(id);
      if (brief === null) return fail("The brief for that request is gone. Ask again.");
      const started = await h.start(r, brief, account);
      if (!started.ok) return started;
      briefs.drop(id);
      const next: CloudRequest = { ...r, provider: h.id, state: "running", account, sessionLink: started.value.link ?? started.value.taskId, id: r.id };
      replace(next);
      return { ok: true, value: next };
    },
    deny: async (id, _reason) => {
      const r = find(id);
      if (r === undefined) return fail("There is no such cloud request.");
      briefs.drop(id);
      replace({ ...r, state: "denied" });
      return { ok: true, value: null };
    },
    ...(h.diffOf === undefined ? {} : { diff: async (id: string) => { const r = find(id); return r === undefined ? fail<string>("There is no such cloud request.") : h.diffOf!(r); } }),
    ...(h.applyOf === undefined ? {} : { apply: async (id: string) => { const r = find(id); return r === undefined ? fail<string>("There is no such cloud request.") : h.applyOf!(r); } }),
  };
};

const SIGN_IN_CLAUDE = "claude auth login";
const SIGN_IN_CODEX = "codex login";

export interface LocalSettings {
  readonly binary?: string;
  /** Codex needs the environment the task runs in (see `codex cloud` to browse). */
  readonly codexEnv?: string;
  /** Extra Codex logins by name, each a CODEX_HOME folder. Absent: this computer's own login. */
  readonly codexHomes?: Readonly<Record<string, string>>;
  /** Extra Claude logins by name, each a CLAUDE_CONFIG_DIR folder. Absent: this computer's own login. */
  readonly claudeHomes?: Readonly<Record<string, string>>;
}

const NO_USAGE = (provider: ProviderId, accounts: ReadonlyArray<string>): Outcome<ReadonlyArray<Usage>> => ({
  ok: true,
  value: accounts.map((account) => ({ provider, account, weeklyPercent: null, resetsAt: null, rejected: false, pointsThisWeek: null })),
});

/** Claude: `claude auth status` for who is signed in; `claude --cloud` to start. Named logins are CLAUDE_CONFIG_DIR folders. */
export const claudeHarness = (exec: Exec, s: LocalSettings = {}): LocalHarness => {
  const bin = s.binary ?? "claude";
  const homes = s.claudeHomes ?? {};
  const own = "This computer's Claude login";
  /** Account label (the login's address when known) -> the folder it lives in; empty means the computer's own. */
  const dirOf = new Map<string, string>();
  let signed: ReadonlyArray<string> = [];
  const probe = async (dir: string | undefined) => {
    const r = await exec(bin, ["auth", "status", "--json"], { ...(dir === undefined ? {} : { env: { CLAUDE_CONFIG_DIR: dir } }), timeoutMs: 15_000 });
    let o: { loggedIn?: unknown; email?: unknown } = {};
    try {
      o = JSON.parse(r.stdout) as typeof o;
    } catch {
      // not signed in prints nothing useful
    }
    return { missing: r.missing === true, loggedIn: o.loggedIn === true, email: typeof o.email === "string" ? o.email : null };
  };
  const detect = async (): Promise<Detection> => {
    dirOf.clear();
    const targets: ReadonlyArray<[string, string | undefined]> = Object.keys(homes).length === 0 ? [[own, undefined]] : Object.entries(homes);
    const names: string[] = [];
    let any = false;
    for (const [name, dir] of targets) {
      const p = await probe(dir);
      if (p.missing) return { installed: false, signedIn: false, identity: null, line: "Claude: not installed. Install Claude Code, then sign in.", signInCommand: null };
      if (p.loggedIn) {
        any = true;
        const label = p.email ?? name;
        names.push(label);
        if (dir !== undefined) dirOf.set(label, dir);
      }
    }
    signed = names;
    if (any) return { installed: true, signedIn: true, identity: names[0] ?? null, line: `Claude: signed in${names[0] === undefined || names[0] === own ? "" : ` as ${names.join(", ")}`}`, signInCommand: null };
    return { installed: true, signedIn: false, identity: null, line: `Claude: not signed in. Run: ${SIGN_IN_CLAUDE}`, signInCommand: SIGN_IN_CLAUDE };
  };
  return {
    id: "claude", label: "Claude", driver: "claudeAgent", resultKind: "pr", canCancel: false,
    detect,
    accounts: () => (signed.length === 0 ? [own] : signed),
    // ASSUMPTION to confirm in the pilot: `claude --cloud <description>` starts a cloud session and prints its
    // claude.ai/code link. The command line is built here and nowhere else.
    start: async (r, brief, account) => {
      const dir = dirOf.get(account);
      const r2 = await exec(bin, ["--cloud", `${brief}\n\nRepository: ${r.repo ?? ""}\nBranch: ${r.branch ?? ""}`], { ...(dir === undefined ? {} : { env: { CLAUDE_CONFIG_DIR: dir } }), timeoutMs: 180_000 });
      if (r2.missing === true) return fail("Claude Code is not installed on this computer.");
      if (r2.code !== 0) return fail("Claude could not start the cloud task. Check that you are signed in, and that GitHub is connected (/web-setup).");
      const link = /https:\/\/claude\.ai\/code\/[^\s"')]+/.exec(r2.stdout)?.[0] ?? null;
      return { ok: true, value: { link, taskId: null } };
    },
    // Claude's own figures are read from the account page, not by this program.
    usage: async () => NO_USAGE("claude", signed.length === 0 ? [own] : signed),
  };
};

/** Codex: `codex login status`, then `codex cloud exec|status|diff|apply`. Logins are the computer's own, or named CODEX_HOME folders. */
export const codexHarness = (exec: Exec, s: LocalSettings = {}): LocalHarness => {
  const bin = s.binary ?? "codex";
  const homes = s.codexHomes ?? {};
  const names = (): ReadonlyArray<string> => (Object.keys(homes).length === 0 ? ["This computer's Codex login"] : Object.keys(homes));
  const envFor = (account: string) => (homes[account] === undefined ? undefined : { CODEX_HOME: homes[account]! });
  const run = (args: ReadonlyArray<string>, account: string, timeoutMs = 60_000) => {
    const env = envFor(account);
    return exec(bin, args, { ...(env === undefined ? {} : { env }), timeoutMs });
  };
  const idIn = (text: string): string | null => /\b(task_[A-Za-z0-9_-]+)\b/.exec(text)?.[1] ?? /chatgpt\.com\/[^\s]*\/tasks?\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;
  return {
    id: "codex", label: "Codex", driver: "codex", resultKind: "diff", canCancel: false, diff: true,
    detect: async () => {
      const r = await exec(bin, ["login", "status"], { timeoutMs: 15_000 });
      if (r.missing === true) return { installed: false, signedIn: false, identity: null, line: "Codex: not installed. Install the Codex CLI, then sign in.", signInCommand: null };
      const out = `${r.stdout}\n${r.stderr}`;
      return r.code === 0 && /logged in/i.test(out)
        ? { installed: true, signedIn: true, identity: null, line: `Codex: ${out.split("\n").find((l) => /logged in/i.test(l))!.trim()}`, signInCommand: null }
        : { installed: true, signedIn: false, identity: null, line: `Codex: not signed in. Run: ${SIGN_IN_CODEX}`, signInCommand: SIGN_IN_CODEX };
    },
    accounts: names,
    start: async (r, brief, account) => {
      if ((s.codexEnv ?? "") === "") return fail("Codex Cloud needs an environment. Choose one under Cloud (run `codex cloud` to see yours).");
      const x = await run(["cloud", "exec", "--env", s.codexEnv!, ...(r.branch === null ? [] : ["--branch", r.branch]), brief], account, 120_000);
      if (x.missing === true) return fail("Codex is not installed on this computer.");
      if (x.code !== 0) return fail("Codex could not start the cloud task. Check that you are signed in.");
      return { ok: true, value: { link: /https?:\/\/\S+/.exec(x.stdout)?.[0] ?? null, taskId: idIn(x.stdout) } };
    },
    // `codex cloud status` prints text; the first word that names a state is taken, anything else leaves it running.
    refresh: async (r) => {
      const task = r.sessionLink === null ? null : idIn(r.sessionLink);
      if (task === null || r.account === null) return fail("Tessaya cannot read that task's progress. Open its link.");
      const x = await run(["cloud", "status", task], r.account);
      const text = x.stdout.toLowerCase();
      const state = /\b(failed|error)\b/.test(text) ? "failed" : /\b(ready|completed|complete|done)\b/.test(text) ? "done" : "running";
      return x.code === 0 ? { ok: true, value: { ...r, state } } : fail("Codex did not answer.");
    },
    usage: async () => NO_USAGE("codex", names()),
    diffOf: async (r) => {
      const task = r.sessionLink === null ? null : idIn(r.sessionLink);
      if (task === null || r.account === null) return fail("There is no task to read a diff from.");
      const x = await run(["cloud", "diff", task], r.account);
      return x.code === 0 ? { ok: true, value: x.stdout } : fail("Codex did not give a diff.");
    },
    applyOf: async (r) => {
      const task = r.sessionLink === null ? null : idIn(r.sessionLink);
      if (task === null || r.account === null) return fail("There is no task to apply.");
      const x = await run(["cloud", "apply", task], r.account);
      return x.code === 0 ? { ok: true, value: x.stdout.trim() || "Applied." } : fail("Codex could not apply that change here.");
    },
  };
};
