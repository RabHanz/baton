/**
 * What the HUD and the tray say, as pure functions of the state, so the words
 * and colours are tested rather than eyeballed.
 */
import type { VoiceState, VoiceUtterance } from "./voiceTypes.ts";

export interface HudView {
  readonly label: string;
  /** Dot colour. Muted is the only red: it is the one state that ignores him. */
  readonly color: string;
  /** Pulses while the mic is actually being listened to for words. */
  readonly pulsing: boolean;
}

const VIEWS: Record<VoiceState, HudView> = {
  sleeping: { label: "Sleeping", color: "#6b7280", pulsing: false },
  listening: { label: "Listening", color: "#22c55e", pulsing: true },
  command_window: { label: "Command", color: "#3b82f6", pulsing: true },
  conversation: { label: "Conversation", color: "#6366f1", pulsing: true },
  direct_session: { label: "Direct to session", color: "#f59e0b", pulsing: true },
  dictation: { label: "Dictating", color: "#14b8a6", pulsing: true },
  muted: { label: "Muted", color: "#ef4444", pulsing: false },
};

export const hudView = (state: VoiceState): HudView => VIEWS[state];

/** Where an utterance goes, said the way the HUD shows it after he speaks. */
export type VoiceRoute = "focused_session" | "focused_field" | "fabric_intent";

export const routeFor = (utterance: VoiceUtterance): VoiceRoute =>
  utterance.mode === "dictation"
    ? "focused_field"
    : utterance.mode === "direct_session"
      ? "focused_session"
      : "fabric_intent";

const ROUTE_LABEL: Record<VoiceRoute, string> = {
  focused_session: "to the focused session",
  focused_field: "typed into the focused field",
  fabric_intent: "to Fabric",
};

/** The brief line under the dot after each utterance. */
export const utteranceCaption = (utterance: VoiceUtterance, maxLength = 80): string => {
  const text =
    utterance.text.length > maxLength
      ? `${utterance.text.slice(0, maxLength - 1)}…`
      : utterance.text;
  return `“${text}” ${ROUTE_LABEL[routeFor(utterance)]}`;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The HUD's markup for one moment. Rendered into a tiny always-on-top window. */
export const renderHudHtml = (input: {
  readonly state: VoiceState;
  readonly caption: string | null;
  readonly device: string | null;
}): string => {
  const view = hudView(input.state);
  const caption =
    input.caption === null ? "" : `<div class="cap">${escapeHtml(input.caption)}</div>`;
  const device = input.device === null ? "" : ` title="${escapeHtml(input.device)}"`;
  return `<div class="hud" data-state="${input.state}"${device}><span class="dot${view.pulsing ? " pulse" : ""}" style="background:${view.color}"></span><span class="label">${escapeHtml(view.label)}</span>${caption}</div>`;
};

export const HUD_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font:12px system-ui,sans-serif;-webkit-user-select:none;user-select:none}
.hud{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:300px;padding:5px 9px;border-radius:12px;background:rgba(17,17,20,.82);color:#f4f4f5;-webkit-app-region:drag}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.pulse{animation:p 1.4s ease-in-out infinite}
@keyframes p{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.pulse{animation:none}}
.cap{flex-basis:100%;color:#d4d4d8;line-height:1.35}
</style></head><body><div id="root"></div></body></html>`;
