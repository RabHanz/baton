// @effect-diagnostics globalDate:off
/** The Now area of the window (D149): what needs him, what it keeps track of, what it is doing, learned, and held back. */
import type { WeaveRecord } from "@t3tools/baton-shared/weave";
import type { Commitment } from "@t3tools/baton-shared/commitments";
import type { NeedItem } from "@t3tools/baton-shared/needsMe";

import type { HomeControl } from "../home/batonHome.ts";

export interface NowData {
  /** False until the first read has finished. */
  readonly loaded: boolean;
  readonly needs: ReadonlyArray<NeedItem>;
  readonly unreadable: ReadonlyArray<string>;
  readonly commitments: ReadonlyArray<Commitment>;
  readonly doing: ReadonlyArray<string>;
  readonly learned: ReadonlyArray<string>;
  readonly declined: ReadonlyArray<{ readonly title: string; readonly why: string }>;
  readonly muted: ReadonlyArray<{ readonly topic: string; readonly title: string }>;
  readonly weaves: ReadonlyArray<WeaveRecord>;
}

export const EMPTY_NOW: NowData = {
  loaded: false,
  needs: [],
  unreadable: [],
  commitments: [],
  doing: [],
  learned: [],
  declined: [],
  muted: [],
  weaves: [],
};

const WHY: Record<string, string> = {
  "quiet hours": "It was your quiet hours.",
  "below the bar": "It did not seem worth interrupting you.",
  "hourly budget": "I had already spoken up enough this hour.",
  "you said stop": "You asked me to stop telling you about it.",
};

const NEEDS = "Needs you";
const KEEP = "Keeping track of";
const DOING = "What I am doing";
const LEARNED = "Learned today";
const HELD = "Held back, and why";
const WEAVE = "Between sessions";

const note = (id: string, section: string, label: string, detail: string): HomeControl => ({
  id,
  section,
  label,
  kind: "check",
  status: "ok",
  detail,
});

export const nowControls = (data: NowData, now: number): ReadonlyArray<HomeControl> => {
  const due = (c: Commitment): string =>
    c.due === null
      ? "No date"
      : c.due <= now
        ? "Due now"
        : `Due ${new Date(c.due).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
  return [
    ...(!data.loaded
      ? [note("now.loading", NEEDS, "Reading everything", "This takes a moment.")]
      : data.needs.length === 0
        ? [note("now.empty", NEEDS, "Nothing needs you", "In the sources I can read.")]
        : data.needs.slice(0, 7).map((n, i): HomeControl => ({
            id: `now.need:${i}`,
            section: NEEDS,
            label: n.title,
            kind: "check",
            status: n.weight >= 75 ? "bad" : "warn",
            detail: n.why,
            lead: true,
          }))),
    ...data.unreadable.map((u, i): HomeControl => ({
      id: `now.unread:${i}`,
      section: NEEDS,
      label: `Could not read ${u}`,
      kind: "check",
      status: "warn",
      detail: "So the list above may be missing things.",
    })),
    {
      id: "now.refresh",
      section: NEEDS,
      label: "Check again",
      kind: "action",
      button: "Refresh",
    },
    ...(data.commitments.length === 0
      ? [
          note(
            "now.nocommit",
            KEEP,
            "Nothing yet",
            "Say 'check back on the deploy' or 'remind me', and it is kept here.",
          ),
        ]
      : data.commitments.map((c): HomeControl => ({
          id: `now.c:${c.id}`,
          section: KEEP,
          label: c.text,
          hint: `${c.owner === "you" ? "Yours" : "Mine"}. ${due(c)}.`,
          kind: "action",
          button: "Done",
          secondary: "Drop",
        }))),
    ...(data.doing.length === 0
      ? [
          note(
            "now.idle",
            DOING,
            "Nothing right now",
            "I am not working on or waiting for anything.",
          ),
        ]
      : data.doing.map((d, i) => note(`now.doing:${i}`, DOING, d, ""))),
    ...(data.learned.length === 0
      ? [
          note(
            "now.nolearn",
            LEARNED,
            "Nothing new",
            "What I learn about you and your work appears here, and in Memory.",
          ),
        ]
      : data.learned.map((l, i) => note(`now.learned:${i}`, LEARNED, l, ""))),
    ...(data.weaves.length === 0
      ? [
          note(
            "now.noweave",
            WEAVE,
            "No messages yet",
            "When Tessaya messages one session for another, it is listed here with what came back.",
          ),
        ]
      : data.weaves.slice(0, 10).map((w): HomeControl => ({
          id: `now.weave:${w.id}`,
          section: WEAVE,
          label: `To ${w.toLabel}: ${w.text.slice(0, 90)}`,
          kind: "check",
          status: w.status === "lost" ? "bad" : w.status === "queued" ? "warn" : "ok",
          detail:
            w.status === "replied"
              ? `Replied: ${(w.reply ?? "").slice(0, 200)}`
              : w.status === "delivered"
                ? "Delivered; no reply yet."
                : `${w.status === "lost" ? "Not delivered" : "Waiting"}${w.reason === null ? "" : `: ${w.reason}`}`,
        }))),
    ...data.declined.map((d, i) => note(`now.held:${i}`, HELD, d.title, WHY[d.why] ?? d.why)),
    ...data.muted.map((m): HomeControl => ({
      id: `now.allow:${m.topic}`,
      section: HELD,
      label: `You asked me to stop telling you about ${m.title}`,
      kind: "action",
      button: "Tell me again",
    })),
  ];
};

/** `now.c:<id>` Done, `now.c:<id>:later` Drop, `now.allow:<topic>` raise a muted topic again. */
export const nowAction = (id: string) => {
  const c = /^now\.c:(.+?)(:later)?$/.exec(id);
  if (c !== null) return { kind: "commitment", id: c[1]!, drop: c[2] !== undefined } as const;
  const a = /^now\.allow:(.+)$/.exec(id);
  return a === null ? null : ({ kind: "allow", topic: a[1]! } as const);
};
