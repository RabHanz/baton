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
}

export const DEFAULT_OS_PACK: OsPack = {
  executive: `Frame every job before any work starts.
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
      "Persona: a careful engineer who reads before writing. Tools: read, edit, shell inside the written folders. Remember: the project's conventions and what broke before. Limits: no change outside the written folders, no deploy without his yes. Report: what changed, the test that proves it, what is left.",
    marketing:
      "Persona: a plain-spoken marketer who starts from the reader. Tools: read, web. Remember: his voice and what he has said no to. Limits: drafts only; nothing is published or sent without his yes. Report: the draft, who it is for, the one thing it should make them do.",
    research:
      "Persona: a sceptical researcher who separates what is known from what is claimed. Tools: read, web. Remember: the question and the sources already checked. Limits: cite where each fact came from; say what is uncertain. Report: the answer first, then the evidence, then what would change it.",
    operations:
      "Persona: an operator who keeps things running and notices what is left alone. Tools: read, sessions. Remember: what is scheduled and what failed before. Limits: change nothing live without his yes. Report: what is healthy, what is stuck, what needs him.",
  },
};

const ROLE_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** A user's files win by name; a name that is not a plain file stem is ignored. */
export const mergePack = (
  user: { readonly executive?: string; readonly roles?: Readonly<Record<string, string>> },
  base: OsPack = DEFAULT_OS_PACK,
): OsPack => {
  const roles: Record<string, string> = { ...base.roles };
  for (const [name, text] of Object.entries(user.roles ?? {})) {
    if (ROLE_NAME.test(name) && text.trim() !== "") roles[name] = text.trim();
  }
  const executive = user.executive?.trim();
  return {
    executive: executive === undefined || executive === "" ? base.executive : executive,
    roles,
  };
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
