/**
 * The phone page's API (docs/baton/MOBILE.md), as plain functions so the rules are testable without a server: reading
 * needs the read scope, anything that changes work needs the operate scope, and an approval is answered only if it is still
 * waiting and still says what the page showed.
 */
import { checkWav, parseDecision, type PhoneState } from "@t3tools/baton-shared/phone";

import { askLine, type PhoneAsk } from "@t3tools/baton-shared/phoneRelay";

import type { PostResult } from "./BatonPhoneInbox.ts";
import type { Transcription } from "./BatonPhoneVoice.ts";

export const READ_SCOPE = "orchestration:read";
export const OPERATE_SCOPE = "orchestration:operate";

export interface PhoneDeps {
  readonly state: () => Promise<PhoneState>;
  readonly agree: (id: string) => Promise<void>;
  readonly stop: (id: string) => Promise<boolean>;
  /** A sentence for him: what was done, or why not. */
  readonly retry: (id: string) => Promise<string>;
  /** Leaves words for the desktop assistant, as the user's own (source phone); a repeat of the same id asks once. */
  readonly ask: (id: string, text: string) => Promise<PostResult>;
  readonly askGet: (id: string) => Promise<{ readonly ask: PhoneAsk | null; readonly connected: boolean }>;
  /** Answers a question the desktop mirrored: the button index. False if it was already answered. */
  readonly answerPrompt: (id: string, index: number) => Promise<boolean>;
  readonly transcribe: (wav: Uint8Array) => Promise<Transcription>;
}

export interface PhoneRequest {
  readonly method: string;
  /** The path after `/tessaya/api/`. */
  readonly path: string;
  readonly scopes: ReadonlySet<string>;
  readonly json?: unknown;
  readonly bytes?: Uint8Array;
  /** The client id for a recording (a header), so a retried upload asks once. */
  readonly clientId?: string;
}
export interface PhoneResponse {
  readonly status: number;
  readonly json: Record<string, unknown>;
}

const say = (status: number, message: string): PhoneResponse => ({ status, json: { message } });
const TEXT_MAX = 2_000;

export const handlePhone = async (deps: PhoneDeps, req: PhoneRequest): Promise<PhoneResponse> => {
  const parts = req.path.split("/").filter((p) => p !== "");
  const mutating = req.method !== "GET";
  if (!req.scopes.has(mutating ? OPERATE_SCOPE : READ_SCOPE)) {
    return say(403, mutating ? "This phone may look but not act. Pair it with operate access." : "This phone may not read that.");
  }
  const body = (req.json ?? {}) as Record<string, unknown>;

  if (req.method === "GET" && parts[0] === "state" && parts.length === 1) return { status: 200, json: { ...(await deps.state()) } };
  if (req.method === "GET" && parts[0] === "ask" && parts.length === 2) {
    const { ask, connected } = await deps.askGet(parts[1]!);
    if (ask === null) return say(404, "No such request.");
    return { status: 200, json: { id: ask.id, status: ask.status, line: askLine(ask, connected), spoken: ask.spoken, card: ask.card } };
  }
  if (req.method !== "POST") return say(404, "No such page.");

  if (parts[0] === "approvals" && parts.length === 2) {
    const decision = parseDecision(body["decision"]);
    if (decision === null) return say(400, "Say approve or deny.");
    const now = await deps.state();
    const approval = now.approvals.find((a) => a.id === parts[1]);
    if (approval === undefined) return say(404, "That is no longer waiting for you.");
    if (approval.kind === "prompt" && approval.yes !== undefined && approval.cancel !== undefined) {
      if (body["action"] !== approval.action) return say(409, "It changed since you looked. Look again.");
      const took = await deps.answerPrompt(approval.ref, decision === "approve" ? approval.yes : approval.cancel);
      return took ? say(200, decision === "approve" ? "Approved. Your computer carries on." : "Denied.") : say(409, "It was already answered on your computer.");
    }
    if (!approval.answerable) return say(409, "Only you can answer that one, in its thread.");
    if (body["action"] !== approval.action) return say(409, "It changed since you looked. Look again.");
    if (decision === "approve") await deps.agree(approval.ref);
    else await deps.stop(approval.ref);
    return say(200, decision === "approve" ? "Approved. It starts now." : "Denied. It was stopped.");
  }

  if (parts[0] === "jobs" && parts.length === 3) {
    const row = (await deps.state()).jobs.find((j) => j.id === parts[1]);
    if (row === undefined) return say(404, "No such job.");
    if (parts[2] === "stop") {
      if (!row.canStop) return say(409, "That job is not running.");
      return say(200, (await deps.stop(row.id)) ? "Stopped." : "It had already stopped.");
    }
    if (parts[2] === "retry") {
      if (!row.canRetry) return say(409, row.retryWhy ?? "It cannot be retried.");
      return say(200, await deps.retry(row.id));
    }
  }

  const post = async (id: unknown, words: string): Promise<PhoneResponse> => {
    const made = await deps.ask(typeof id === "string" ? id : "", words);
    if (!made.ok) return say(400, made.why);
    const connected = (await deps.askGet(made.ask.id)).connected;
    return { status: 202, json: { id: made.ask.id, status: made.ask.status, line: askLine(made.ask, connected) } };
  };

  if (parts[0] === "ask" && parts.length === 1) {
    return post(body["id"], typeof body["text"] === "string" ? body["text"].slice(0, TEXT_MAX) : "");
  }

  if (parts[0] === "voice" && parts.length === 1) {
    const wav = req.bytes ?? new Uint8Array();
    const bad = checkWav(wav);
    if (bad !== null) return say(400, bad);
    const heard = await deps.transcribe(wav);
    if (!heard.ok) return say(heard.why.startsWith("Voice is not available") ? 501 : 422, heard.why);
    // What was heard is shown with the answer, so a mishearing is visible.
    const queued = await post(req.clientId, heard.text);
    return { status: queued.status, json: { heard: heard.text, ...queued.json } };
  }
  return say(404, "No such page.");
};
