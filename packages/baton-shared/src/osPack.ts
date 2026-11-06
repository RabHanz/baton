/**
 * The operating-system pack (D148): how Tessaya frames a job before any work, and the specialists it
 * briefs. Data, never code. This neutral default is written from scratch and ships with the app; a
 * user's own pack lives in their user data folder (`operating-system/`), outside the repository and
 * the installer, and wins file by file.
 */
export interface OsPack {
  readonly executive: string;
  /** Role name (a file stem) to its brief. */
  readonly roles: Readonly<Record<string, string>>;
  /** The faces he talks to (the roster), the lead first. */
  readonly personas: ReadonlyArray<Persona>;
  /** The model and effort each file names, by id ("executive" or a role's file stem). */
  readonly models: Readonly<Record<string, Brain>>;
}

/** A model alias the Claude command line accepts, and its `--effort`. */
export interface Brain {
  readonly model: string;
  readonly effort: string;
}

/** Decided defaults: the lead thinks on Opus, specialists work on Sonnet, both at medium. */
const LEAD_BRAIN: Brain = { model: "opus", effort: "medium" };
const SPECIALIST_BRAIN: Brain = { model: "sonnet", effort: "medium" };
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,60}$/;
const EFFORTS: ReadonlySet<string> = new Set(["low", "medium", "high", "xhigh", "max"]);

const brainOf = (fields: Readonly<Record<string, string>>, base: Brain): Brain => {
  const model = fields["model"] ?? "";
  const effort = (fields["effort"] ?? "").toLowerCase();
  return {
    model: MODEL_NAME.test(model) ? model : base.model,
    effort: EFFORTS.has(effort) ? effort : base.effort,
  };
};

/** What a persona or role runs on; a role the pack does not know is a specialist. */
export const modelOf = (pack: OsPack, id: string): Brain =>
  pack.models[id] ?? (id === "executive" ? LEAD_BRAIN : SPECIALIST_BRAIN);

/**
 * A persona is the short front-matter above a pack file's brief: `executive.md` is the lead, and a
 * role file with a `name` is a face of its own. His file wins field by field over the default's.
 */
export interface Persona {
  /** "executive" for the lead, otherwise the role's file stem. */
  readonly id: string;
  readonly name: string;
  /** Null when no wake word reaches it; it still answers to its name. */
  readonly wake: string | null;
  readonly voice: string;
  /** One line of who it is and how it sounds, for its turns. */
  readonly role: string;
  readonly lead: boolean;
  /** Its own tool list (`tools:`, comma separated), which only narrows the gate; null when it has none. */
  readonly tools: ReadonlyArray<string> | null;
}

/** The pack's files as they ship: front-matter for the face, then the brief. */
export interface PackFiles {
  readonly executive: string;
  readonly roles: Readonly<Record<string, string>>;
}

export const DEFAULT_PACK_FILES: PackFiles = {
  executive: `---
name: Tessaya
wake: Tessaya
voice: anna
role: the lead, who sees everything and hands out the work; calm, direct and brief.
model: opus
effort: medium
---
Frame every job before any work starts.
1. Start from the outcome. Say what he wants to be true afterwards, in words that name no solution, and why it matters to him.
2. List the outcomes as a direction, a measure, an object and the circumstance (for example: lower, the time to ship a release, for a small team, in a busy week).
3. Lay the work out as steps: define, locate, prepare, confirm, execute, monitor, modify, conclude.
4. Find the point with the most leverage you can reach: a rule, a flow of information or a feedback loop beats tuning a number.
5. Decide whether to build at all. Say which outcome it serves, the whole cost, and whether it can be undone. Decide fast when it can be undone and slowly when it cannot. "Do not build" is a real answer, with its reason.
6. Brief each specialist you use with a persona, the tools it may use, what it should remember, its limits and when to report back.
7. Ask him only a question whose answer changes the decision.
Show the result as a job brief before work begins: the job, the outcomes, the leverage point, build or not and why, the steps, the specialists, whether it is reversible, and what the job may do.
Workers report outcomes, not activity: what changed against each outcome, the evidence, what is next, what blocks it.`,
  roles: {
    engineering:
      "---\nname: Alfred\nwake: Alfred\nvoice: charles\nrole: sessions, builds and releases; precise and unflappable, says what broke and what is next.\nmodel: sonnet\neffort: medium\n---\nPersona: a careful engineer who reads before writing. Tools: read, edit, shell inside the written folders. Remember: the project's conventions and what broke before. Limits: no change outside the written folders, no deploy without his yes. Report: what changed, the test that proves it, what is left.",
    marketing:
      "---\nmodel: sonnet\neffort: medium\n---\nPersona: a plain-spoken marketer who starts from the reader. Tools: read, web. Remember: his voice and what he has said no to. Limits: drafts only; nothing is published or sent without his yes. Report: the draft, who it is for, the one thing it should make them do.",
    research:
      "---\nname: Sebastian\nvoice: paul\nrole: research and analysis; sceptical and thorough, says what is known and what is only claimed.\nmodel: sonnet\neffort: medium\n---\nPersona: a sceptical researcher who separates what is known from what is claimed. Tools: read, web. Remember: the question and the sources already checked. Limits: cite where each fact came from; say what is uncertain. Report: the answer first, then the evidence, then what would change it.",
    operations:
      "---\nname: Freya\nwake: Freya\nvoice: vera\nrole: his day, his messages and his reminders; warm, quick and practical.\nmodel: sonnet\neffort: medium\n---\nPersona: an operator who keeps things running and notices what is left alone. Tools: read, sessions. Remember: what is scheduled and what failed before. Limits: change nothing live without his yes. Report: what is healthy, what is stuck, what needs him.",
  },
};

const ROLE_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A file's front-matter fields (lower-case keys) and the brief below them. */
export const splitFront = (
  text: string,
): { readonly fields: Readonly<Record<string, string>>; readonly body: string } => {
  const m = FRONT_MATTER.exec(text);
  if (m === null) return { fields: {}, body: text.trim() };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^\s*([a-z ]+?)\s*:\s*(.*?)\s*$/i.exec(line);
    if (kv !== null) fields[kv[1]!.toLowerCase()] = kv[2]!;
  }
  return { fields, body: text.slice(m[0].length).trim() };
};

const face = (
  id: string,
  fields: Readonly<Record<string, string>>,
  lead: boolean,
): Persona | null => {
  const name = fields["name"] ?? "";
  if (name === "" && !lead) return null;
  const wake = fields["wake"] ?? "";
  const tools = fields["tools"];
  return {
    id,
    name: name === "" ? "Tessaya" : name,
    wake: wake === "" ? null : wake,
    voice: (fields["voice"] ?? "").toLowerCase(),
    role: fields["role"] ?? "",
    lead,
    tools:
      tools === undefined || tools.trim() === ""
        ? null
        : tools
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t !== ""),
  };
};

/** One file: his front-matter fields over the default's, and his brief unless he left it empty. */
const mergeFile = (mine: string | undefined, base: string | undefined) => {
  const b = splitFront(base ?? "");
  const m = splitFront(mine ?? "");
  return { fields: { ...b.fields, ...m.fields }, body: m.body === "" ? b.body : m.body };
};

/** A user's files win by name; a name that is not a plain file stem is ignored. */
export const mergePack = (
  user: { readonly executive?: string; readonly roles?: Readonly<Record<string, string>> },
  base: PackFiles = DEFAULT_PACK_FILES,
): OsPack => {
  const files: Record<string, string | undefined> = {};
  for (const [name, text] of Object.entries(user.roles ?? {})) {
    if (ROLE_NAME.test(name) && text.trim() !== "") files[name] = text;
  }
  const executive = mergeFile(user.executive, base.executive);
  const lead = face("executive", executive.fields, true)!;
  const roles: Record<string, string> = {};
  const personas: Persona[] = [lead];
  const models: Record<string, Brain> = { executive: brainOf(executive.fields, LEAD_BRAIN) };
  for (const name of new Set([...Object.keys(base.roles), ...Object.keys(files)])) {
    const role = mergeFile(files[name], base.roles[name]);
    roles[name] = role.body;
    models[name] = brainOf(role.fields, SPECIALIST_BRAIN);
    const persona = face(name, role.fields, false);
    if (persona !== null) personas.push(persona);
  }
  return { executive: executive.body, roles, personas, models };
};

export const DEFAULT_OS_PACK: OsPack = mergePack({});

/**
 * Who answers: the persona whose wake word woke him, else the one he named first in the sentence,
 * else the lead. Lower-case compares, since wake models report their words in either case.
 */
export const personaFor = (
  personas: ReadonlyArray<Persona>,
  said: { readonly wake: string | null; readonly text: string },
): Persona => {
  const lead = personas.find((p) => p.lead) ?? personas[0]!;
  const wake = said.wake?.toLowerCase();
  const woken = personas.find((p) => wake !== undefined && p.wake?.toLowerCase() === wake);
  if (woken !== undefined) return woken;
  const first = /^\s*(?:hey\s+)?([a-z]+)/i.exec(said.text)?.[1]?.toLowerCase();
  return personas.find((p) => p.name.toLowerCase() === first) ?? lead;
};

/** The planning turn's frame, capped so a large personal pack cannot swamp the job. */
export const PACK_PROMPT_CHARS = 8_000;

export const packPrompt = (pack: OsPack): string => {
  const roles = Object.entries(pack.roles)
    .map(([name, brief]) => `- ${name}: ${brief}`)
    .join("\n");
  return `How to frame this job (follow it, and show the job brief first):\n${pack.executive}\n\nSpecialists you may brief:\n${roles}`.slice(
    0,
    PACK_PROMPT_CHARS,
  );
};

/** The one assistant's frame is in every turn, so it is kept shorter than a planning turn's. */
export const ASSISTANT_FRAME_CHARS = 3_000;

/** The executive frame and the specialists' names, for the one assistant that decides and splits jobs. */
export const assistantFrame = (pack: OsPack): string =>
  `How he wants a job framed (his operating-system pack; use it when he hands you long work, asks for a plan or splits one):\n${pack.executive.slice(0, ASSISTANT_FRAME_CHARS)}\n\nSpecialists a job's parts can go to (job_split role): ${Object.keys(pack.roles).join(", ")}.`;
