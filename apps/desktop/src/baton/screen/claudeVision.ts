// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalRandom:off
/**
 * The companion's model: his own `claude`, on his subscription (D1, D84), one conversation per
 * look, lesson or drive. --safe-mode drops hooks/CLAUDE.md/MCP, --tools "" gives it nothing to
 * act with, and ANTHROPIC_API_KEY is removed so it can never bill the API.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

export type VisionContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly mediaType: "image/jpeg" | "image/png";
      readonly data: Buffer;
    };

export interface VisionSession {
  readonly ask: (content: ReadonlyArray<VisionContent>) => Promise<string>;
  readonly dispose: () => void;
}

export interface VisionSessionOptions {
  readonly claudeBinary: string;
  readonly model: string;
  readonly systemPrompt: string;
  /** An empty directory of Baton's own, so no project's settings are picked up. */
  readonly workDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: string;
  readonly timeoutMs?: number;
}

export const visionArgs = (systemPromptFile: string, model: string): ReadonlyArray<string> => [
  "-p",
  "--safe-mode",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--model",
  model,
  "--tools",
  "",
  "--no-session-persistence",
  "--system-prompt-file",
  systemPromptFile,
];

/** The child's environment: his, minus anything that would bill the API instead of the plan. */
export const subscriptionEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const next = { ...env };
  delete next["ANTHROPIC_API_KEY"];
  delete next["ANTHROPIC_AUTH_TOKEN"];
  return next;
};

export const userMessage = (content: ReadonlyArray<VisionContent>): string =>
  JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: content.map((c) =>
        c.type === "text"
          ? { type: "text", text: c.text }
          : {
              type: "image",
              source: { type: "base64", media_type: c.mediaType, data: c.data.toString("base64") },
            },
      ),
    },
  });

/** The answer in one stream-json line, or null when the line is something else. */
export const resultOf = (
  line: string,
):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string }
  | null => {
  let event: { type?: unknown; is_error?: unknown; result?: unknown; subtype?: unknown };
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event.type !== "result") return null;
  if (event.is_error === true || typeof event.result !== "string") {
    return {
      ok: false,
      error: typeof event.result === "string" ? event.result : String(event.subtype ?? "error"),
    };
  }
  return { ok: true, text: event.result };
};

/**
 * On Windows a bare "claude" may be the native `claude.exe` or npm's `claude.cmd`; spawn without
 * a shell finds only the first, so look on PATH for both. Elsewhere the name is used as given.
 */
export const resolveBinary = (
  name: string,
  platform: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = NodeFS.existsSync,
): string => {
  if (platform !== "win32" || NodePath.extname(name) !== "" || name.includes("\\")) return name;
  const dirs = (env["PATH"] ?? env["Path"] ?? "").split(";").filter(Boolean);
  for (const ext of [".exe", ".cmd"])
    for (const dir of dirs) {
      const candidate = NodePath.win32.join(dir, `${name}${ext}`);
      if (exists(candidate)) return candidate;
    }
  return name;
};

export const startVisionSession = (options: VisionSessionOptions): VisionSession => {
  NodeFS.mkdirSync(options.workDir, { recursive: true });
  const promptFile = NodePath.join(
    options.workDir,
    `prompt-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );
  NodeFS.writeFileSync(promptFile, options.systemPrompt, { mode: 0o600 });
  const binary = resolveBinary(options.claudeBinary, options.platform, options.env);
  // A Windows npm install is `claude.cmd`; a shell is needed to start one, and every argument here is ours.
  const viaShell = options.platform === "win32" && /\.cmd$/i.test(binary);
  const child = NodeChildProcess.spawn(
    binary,
    visionArgs(promptFile, options.model).map((a) => (viaShell ? `"${a}"` : a)),
    {
      cwd: options.workDir,
      env: subscriptionEnv(options.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: viaShell,
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  const waiting: Array<{ resolve: (text: string) => void; reject: (error: Error) => void }> = [];
  let dead: Error | null = null;
  const fail = (error: Error) => {
    dead = error;
    for (const w of waiting.splice(0)) w.reject(error);
  };
  child.on("error", (error) =>
    fail(
      new Error(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? `Claude Code was not found at "${options.claudeBinary}". Install it and sign in, or set its path in Baton's screen settings.`
          : error.message,
      ),
    ),
  );
  child.on("exit", (code) =>
    fail(
      new Error(
        `Claude stopped (${code ?? "signal"}). ${stderr.trim().split("\n").at(-1) ?? ""}`.trim(),
      ),
    ),
  );
  NodeReadline.createInterface({ input: child.stdout }).on("line", (line) => {
    const result = resultOf(line);
    if (result === null) return;
    const next = waiting.shift();
    if (next === undefined) return;
    if (result.ok) next.resolve(result.text);
    else next.reject(new Error(result.error));
  });

  // One question at a time: stream-json answers in order, and a turn must finish before the next.
  let chain: Promise<unknown> = Promise.resolve();
  const ask = (content: ReadonlyArray<VisionContent>): Promise<string> => {
    const turn = chain.then(
      () =>
        new Promise<string>((resolve, reject) => {
          if (dead !== null) return reject(dead);
          // A late answer would be taken as the next question's, so a timeout ends the session.
          const timer = setTimeout(() => {
            fail(new Error("Claude took too long to answer."));
            child.kill();
          }, options.timeoutMs ?? 90_000);
          waiting.push({
            resolve: (text) => (clearTimeout(timer), resolve(text)),
            reject: (error) => (clearTimeout(timer), reject(error)),
          });
          child.stdin.write(`${userMessage(content)}\n`);
        }),
    );
    chain = turn.catch(() => undefined);
    return turn;
  };

  return {
    ask,
    dispose: () => {
      child.stdin.end();
      child.kill();
      NodeFS.rmSync(promptFile, { force: true });
    },
  };
};
