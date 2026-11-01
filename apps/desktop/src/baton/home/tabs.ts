/**
 * The tabs of Baton's window (D140) and which tab each control lives on. Producers keep their own
 * ids; this one table decides where they appear, so moving a control is a one-line change.
 */
export const TABS = [
  { id: "home", label: "Home" },
  { id: "sessions", label: "Sessions" },
  { id: "dictation", label: "Dictation" },
  { id: "history", label: "History" },
  { id: "assistant", label: "Assistant" },
  { id: "voice", label: "Voice" },
  { id: "screen", label: "Screen" },
  { id: "usage", label: "Usage" },
  { id: "checks", label: "Checks" },
] as const;

export type TabId = (typeof TABS)[number]["id"] | "settings";

const EXACT: Readonly<Record<string, TabId>> = {
  "v.enabled": "voice",
  "v.muted": "voice",
  "v.direct": "voice",
  "v.mic": "voice",
  "v.sounds": "voice",
  "v.pillRest": "voice",
  "v.pillEdge": "voice",
  "v.pillCentre": "voice",
  "v.volume": "voice",
  "s.voice": "voice",
  "s.volume": "voice",
  "s.output": "voice",
  "v.dictation": "dictation",
  "v.download": "dictation",
  "v.cleanup": "dictation",
  "v.delivery": "dictation",
  "v.appMode": "dictation",
  "v.speechModel": "dictation",
  "v.copyLast": "dictation",
  "v.keepVoice": "history",
  "v.keepDays": "history",
  "v.keepCap": "history",
  "v.keepSpace": "history",
  "s.brain": "assistant",
  "s.brainCheck": "assistant",
  "s.act": "assistant",
  "s.account": "assistant",
  "s.accountEmail": "assistant",
  "s.capture": "screen",
  "v.check": "checks",
  "v.micTest": "checks",
  "v.login": "settings",
  "v.appearance": "settings",
  "v.file": "settings",
  "u.act": "settings",
  "n.empty": "sessions",
  "n.note": "sessions",
};

export const tabOf = (id: string): TabId => {
  const exact = EXACT[id];
  if (exact !== undefined) return exact;
  if (id.startsWith("v.wake:")) return "voice";
  if (id.startsWith("v.result:")) return "checks";
  if (id.startsWith("n:")) return "sessions";
  if (id.startsWith("u.")) return "settings";
  return "settings";
};
