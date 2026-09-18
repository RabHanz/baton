/**
 * One chronological answer to "what happened to this work, and who asked".
 *
 * Fabric writes three kinds of record, in three tables, for three different
 * reasons: intents (a person said something), firings (a rule did something),
 * and provider sessions (an account was attached or released). Each is useful
 * on its own and none of them answers the question people actually ask after
 * the fact, which is *what happened here, in order*.
 *
 * So the audit view is a merge, and it is a pure function over records the
 * caller already has. Deliberately not a fourth table: a log written alongside
 * the things it describes drifts from them, and the drift is discovered when
 * somebody is trying to work out what went wrong.
 *
 * @module fabricAudit
 */

export type FabricAuditActor =
  /** A person, through the intent surface or a client. */
  | "user"
  /** An orchestration rule. */
  | "rule"
  /** The environment itself: a session started, a thread ended. */
  | "environment";

export interface FabricAuditEntry {
  readonly at: string;
  readonly actor: FabricAuditActor;
  /** One line, in the user's terms. */
  readonly summary: string;
  /** `resolved`, `refused`, `failed`, `skipped` — whatever the source recorded. */
  readonly outcome: string;
}

export interface AuditIntentRecord {
  readonly at: string;
  readonly text: string;
  readonly outcome: string;
  readonly reply: string;
  readonly refusalReason: string | null;
}

export interface AuditFiringRecord {
  readonly startedAt: string;
  readonly ruleId: string;
  readonly triggeredBy: string;
  readonly outcome: string;
  readonly detail: string;
}

export interface AuditProviderSessionRecord {
  readonly attachedAt: string;
  readonly detachedAt: string | null;
  readonly providerInstanceId: string | null;
  readonly role: string;
  readonly origin: string;
}

/**
 * Merge the three, newest first.
 *
 * Newest first because the question is almost always "what just happened",
 * and a reader who wants the beginning can read to the end of a short list.
 */
export const buildAuditTrail = (input: {
  readonly intents: ReadonlyArray<AuditIntentRecord>;
  readonly firings: ReadonlyArray<AuditFiringRecord>;
  readonly providerSessions: ReadonlyArray<AuditProviderSessionRecord>;
}): ReadonlyArray<FabricAuditEntry> => {
  const entries: FabricAuditEntry[] = [];

  for (const intent of input.intents) {
    entries.push({
      at: intent.at,
      actor: "user",
      summary:
        intent.refusalReason === null
          ? `“${intent.text}” — ${intent.reply}`
          : `“${intent.text}” — refused (${intent.refusalReason})`,
      outcome: intent.outcome,
    });
  }

  for (const firing of input.firings) {
    entries.push({
      at: firing.startedAt,
      actor: "rule",
      summary: `${firing.ruleId} fired on ${firing.triggeredBy}${
        firing.detail.length === 0 ? "" : ` — ${firing.detail}`
      }`,
      outcome: firing.outcome,
    });
  }

  for (const session of input.providerSessions) {
    const who = session.providerInstanceId ?? "an account";
    entries.push({
      at: session.attachedAt,
      actor: "environment",
      summary: `${who} attached as ${session.role} (${session.origin})`,
      outcome: "attached",
    });
    if (session.detachedAt !== null) {
      entries.push({
        at: session.detachedAt,
        actor: "environment",
        summary: `${who} released`,
        outcome: "detached",
      });
    }
  }

  return entries.sort((left, right) => {
    const difference = Date.parse(right.at) - Date.parse(left.at);
    // Same instant: a person's sentence before the rule it triggered, so cause
    // reads above effect rather than in whatever order the tables came back.
    if (difference !== 0) return difference;
    const rank: Readonly<Record<FabricAuditActor, number>> = {
      user: 0,
      rule: 1,
      environment: 2,
    };
    return rank[left.actor] - rank[right.actor];
  });
};
