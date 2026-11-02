/**
 * Other machines a weave may reach (D149): off unless `BATON_WEAVE_HOSTS` lists them. Each is an ssh
 * target with an optional key and the full path of herdr there. Pure: parsing, and the exact ssh
 * command for a herdr call, with every argument quoted for the remote shell.
 */
export interface WeaveHost {
  /** What the person calls the machine: "onnyx". */
  readonly name: string;
  /** `user@host` or a host from ssh config. */
  readonly target: string;
  readonly key?: string;
  /** Full path of herdr on that machine (a non-login shell may not have it on PATH). */
  readonly herdr: string;
}

const NAME = /^[A-Za-z0-9_-]{1,32}$/;
const TARGET = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,100}$/;
const PATH = /^[A-Za-z0-9_./~ -]{1,200}$/;

/** Hosts from JSON `[{"name","target","key?","herdr?"}]`; anything malformed is dropped and named. */
export const parseWeaveHosts = (
  raw: string | undefined,
): { readonly hosts: ReadonlyArray<WeaveHost>; readonly rejected: ReadonlyArray<string> } => {
  if (raw === undefined || raw.trim() === "") return { hosts: [], rejected: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { hosts: [], rejected: ["BATON_WEAVE_HOSTS is not valid JSON"] };
  }
  if (!Array.isArray(data)) return { hosts: [], rejected: ["BATON_WEAVE_HOSTS is not a list"] };
  const hosts: WeaveHost[] = [];
  const rejected: string[] = [];
  for (const item of data) {
    const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const name = o["name"];
    const target = o["target"];
    const key = o["key"];
    const herdr = o["herdr"] ?? "herdr";
    const ok =
      typeof name === "string" &&
      NAME.test(name) &&
      name !== "here" &&
      typeof target === "string" &&
      TARGET.test(target) &&
      (key === undefined || (typeof key === "string" && PATH.test(key))) &&
      typeof herdr === "string" &&
      PATH.test(herdr);
    if (!ok) {
      rejected.push(typeof name === "string" ? name : "a host");
      continue;
    }
    hosts.push({
      name,
      target,
      herdr,
      ...(typeof key === "string" ? { key } : {}),
    });
  }
  return { hosts, rejected };
};

/** One argument as the remote shell will read it. */
export const shellQuote = (arg: string): string => `'${arg.replace(/'/g, `'\\''`)}'`;

/** The ssh invocation for `herdr <args>` on a host. BatchMode: a missing key fails, it never prompts. */
export const sshHerdr = (
  host: WeaveHost,
  args: ReadonlyArray<string>,
): { readonly file: "ssh"; readonly args: ReadonlyArray<string> } => ({
  file: "ssh",
  args: [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    ...(host.key === undefined ? [] : ["-i", host.key]),
    host.target,
    [host.herdr, ...args].map(shellQuote).join(" "),
  ],
});
