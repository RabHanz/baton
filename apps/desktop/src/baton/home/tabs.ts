/**
 * The tabs of Baton's window (D140) and which tab each control lives on. Producers keep their own
 * ids; this one table decides where they appear, so moving a control is a one-line change.
 */
export const TABS = [
  { id: "home", label: "Home" },
  { id: "now", label: "Now" },
  { id: "snippets", label: "Snippets" },
  { id: "insights", label: "Insights" },
  { id: "scratchpad", label: "Scratchpad" },
  { id: "style", label: "Style" },
  { id: "transforms", label: "Transforms" },
  { id: "sessions", label: "Sessions" },
  { id: "approvals", label: "Approvals" },
  { id: "jobs", label: "Jobs" },
  { id: "dictation", label: "Dictation" },
  { id: "history", label: "History" },
  { id: "memory", label: "Memory" },
  { id: "vault", label: "Vault" },
  { id: "tools", label: "Skills" },
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
  "v.listenAfterWake": "voice",
  "v.conversation": "voice",
  "v.waitMs": "voice",
  "v.direct": "voice",
  "v.mic": "voice",
  "v.sounds": "voice",
  "v.cues": "voice",
  "v.verifyWake": "voice",
  "v.holdKeyCues": "voice",
  "v.pillRest": "voice",
  "v.pillEdge": "voice",
  "v.pillPlace": "voice",
  "v.pillMove": "voice",
  "v.volume": "voice",
  "s.voice": "voice",
  "v.audition": "voice",
  "s.volume": "voice",
  "s.output": "voice",
  "v.dictation": "dictation",
  "v.download": "dictation",
  "v.cleanup": "dictation",
  "v.delivery": "dictation",
  "v.appMode": "dictation",
  "v.speechModel": "dictation",
  "v.copyLast": "dictation",
  "v.learnWords": "dictation",
  "v.language": "dictation",
  "d.import": "dictation",
  "v.keepVoice": "history",
  "v.keepDays": "history",
  "v.keepCap": "history",
  "v.keepSpace": "history",
  "s.brain": "assistant",
  "s.brainCheck": "assistant",
  "s.act": "assistant",
  "s.oneAssistant": "assistant",
  "s.chrome": "assistant",
  "s.social": "assistant",
  "s.account": "assistant",
  "v.notice": "assistant",
  "v.quiet": "assistant",
  "v.brief": "assistant",
  "s.accountEmail": "assistant",
  "s.capture": "screen",
  "v.check": "checks",
  "v.diag": "checks",
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
  if (/^now[:.]/.test(id)) return "now";
  if (/^sn[:.]/.test(id)) return "snippets";
  if (/^tr[:.]/.test(id)) return "transforms";
  if (/^st[:.]/.test(id)) return "style";
  if (/^in[:.]/.test(id)) return "insights";
  if (/^sc[:.]/.test(id) || /^tf[:.]/.test(id)) return "scratchpad";
  if (/^j[a-z]?[:.]/.test(id)) return "jobs";
  if (/^a[:.]/.test(id)) return "approvals";
  if (/^k[:.]/.test(id)) return "tools";
  if (/^p[:.]/.test(id)) return "memory";
  if (id.startsWith("vt:") || id.startsWith("vt.")) return "vault";
  if (id.startsWith("m:") || id.startsWith("m.")) return "memory";
  if (id.startsWith("u.")) return "settings";
  return "settings";
};
