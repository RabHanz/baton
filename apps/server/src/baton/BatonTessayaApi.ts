/**
 * The phone page's API (docs/baton/MOBILE.md), as plain functions so the rules are testable without a server: reading
 * needs the read scope, anything that changes work needs the operate scope, and an approval is answered only if it is still
 * waiting and still says what the page showed.
 */
import { checkWav, parseDecision, type PhoneState } from "@t3tools/baton-shared/phone";

import type { Transcription } from "./BatonPhoneVoice.ts";

export const READ_SCOPE = "orchestration:read";
export const OPERATE_SCOPE = "orchestration:operate";

export interface PhoneDeps {
  readonly state: () => Promise<PhoneState>;
  readonly agree: (id: string) => Promise<void>;
  readonly stop: (id: string) => Promise<boolean>;
  /** A sentence for him: what was done, or why not. */
  readonly retry: (id: string) => Promise<string>;
  /** Types a sentence to the one assistant of this server and returns its reply. */
  readonly say: (text: string) => Promise<string>;
  readonly transcribe: (wav: Uint8Array) => Promise<Transcription>;
}

export interface PhoneRequest {
  readonly method: string;
  /** The path after `/tessaya/api/`. */
  readonly path: string;
  readonly scopes: ReadonlySet<string>;
  readonly json?: unknown;
  readonly bytes?: Uint8Array;
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
  if (req.method !== "POST") return say(404, "No such page.");

  if (parts[0] === "approvals" && parts.length === 2) {
    const decision = parseDecision(body["decision"]);
    if (decision === null) return say(400, "Say approve or deny.");
    const now = await deps.state();
    const approval = now.approvals.find((a) => a.id === parts[1]);
    if (approval === undefined) return say(404, "That is no longer waiting for you.");
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

  if (parts[0] === "say" && parts.length === 1) {
    const text = typeof body["text"] === "string" ? body["text"].trim().slice(0, TEXT_MAX) : "";
    return text === "" ? say(400, "Say something.") : { status: 200, json: { reply: await deps.say(text) } };
  }

  if (parts[0] === "voice" && parts.length === 1) {
    const wav = req.bytes ?? new Uint8Array();
    const bad = checkWav(wav);
    if (bad !== null) return say(400, bad);
    const heard = await deps.transcribe(wav);
    if (!heard.ok) return say(heard.why.startsWith("Voice is not available") ? 501 : 422, heard.why);
    // What was heard is shown with the answer, so a mishearing is visible and nothing is acted on unseen.
    return { status: 200, json: { heard: heard.text, reply: await deps.say(heard.text) } };
  }
  return say(404, "No such page.");
};
