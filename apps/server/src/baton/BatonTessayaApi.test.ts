import type { PhoneState } from "@t3tools/baton-shared/phone";
import { describe, expect, it } from "vite-plus/test";

import { handlePhone, OPERATE_SCOPE, READ_SCOPE, type PhoneDeps } from "./BatonTessayaApi.ts";

const state: PhoneState = {
  badge: 1,
  needs: [],
  approvals: [
    { id: "p:j1", kind: "plan", title: "Site", action: "Start the work as planned", permission: "x", ref: "j1", answerable: true },
    { id: "s:k", kind: "session", title: "Sess", action: "Answer its question", permission: "x", ref: "k", answerable: false },
  ],
  now: [],
  jobs: [
    { id: "j1", title: "Site", status: "waiting", canStop: false, canRetry: false, retryWhy: "no" },
    { id: "run", title: "R", status: "working", canStop: true, canRetry: false, retryWhy: "It has not failed" },
    { id: "bad", title: "B", status: "failed", canStop: false, canRetry: true, retryWhy: null },
  ],
  weaves: [],
};
const make = () => {
  const calls: string[] = [];
  const deps: PhoneDeps = {
    state: async () => state,
    agree: async (id) => void calls.push(`agree ${id}`),
    stop: async (id) => (calls.push(`stop ${id}`), true),
    retry: async (id) => (calls.push(`retry ${id}`), "Asked it to try again."),
    say: async (t) => (calls.push(`say ${t}`), "ok"),
    transcribe: async () => ({ ok: true, text: "what needs me" }),
  };
  return { deps, calls };
};
const read = new Set([READ_SCOPE]);
const operate = new Set([READ_SCOPE, OPERATE_SCOPE]);
const wav = () => {
  const b = new Uint8Array(100);
  const v = new DataView(b.buffer);
  b.set([82, 73, 70, 70], 0);
  b.set([87, 65, 86, 69], 8);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16_000, true);
  v.setUint16(34, 16, true);
  return b;
};

describe("the phone API", () => {
  it("reads with the read scope and refuses every change without the operate scope", async () => {
    const { deps, calls } = make();
    expect((await handlePhone(deps, { method: "GET", path: "state", scopes: read })).status).toBe(200);
    expect((await handlePhone(deps, { method: "GET", path: "state", scopes: new Set() })).status).toBe(403);
    for (const path of ["approvals/p:j1", "jobs/run/stop", "say", "voice"]) {
      expect((await handlePhone(deps, { method: "POST", path, scopes: read, json: { decision: "approve", text: "x" }, bytes: wav() })).status).toBe(403);
    }
    expect(calls).toEqual([]);
  });

  it("answers an approval only while it waits and still says what the page showed", async () => {
    const { deps, calls } = make();
    const post = (path: string, json: unknown) => handlePhone(deps, { method: "POST", path, scopes: operate, json });
    expect((await post("approvals/p:j1", { decision: "approve", action: "Start the work as planned" })).status).toBe(200);
    expect((await post("approvals/p:j1", { decision: "deny", action: "Start the work as planned" })).status).toBe(200);
    expect((await post("approvals/p:j1", { decision: "approve", action: "Something else" })).status).toBe(409);
    expect((await post("approvals/p:gone", { decision: "approve", action: "x" })).status).toBe(404);
    expect((await post("approvals/s:k", { decision: "approve", action: "Answer its question" })).status).toBe(409);
    expect((await post("approvals/p:j1", { decision: "maybe" })).status).toBe(400);
    expect(calls).toEqual(["agree j1", "stop j1"]);
  });

  it("stops what runs and retries what failed, and says why not otherwise", async () => {
    const { deps, calls } = make();
    const post = (path: string) => handlePhone(deps, { method: "POST", path, scopes: operate });
    expect((await post("jobs/run/stop")).status).toBe(200);
    expect((await post("jobs/bad/stop")).status).toBe(409);
    expect((await post("jobs/bad/retry")).json["message"]).toBe("Asked it to try again.");
    expect(await post("jobs/run/retry")).toMatchObject({ status: 409, json: { message: "It has not failed" } });
    expect(calls).toEqual(["stop run", "retry bad"]);
  });

  it("sends typed words and heard words to the one assistant, showing what was heard", async () => {
    const { deps, calls } = make();
    expect((await handlePhone(deps, { method: "POST", path: "say", scopes: operate, json: { text: "  what is running " } })).json).toEqual({ reply: "ok" });
    expect((await handlePhone(deps, { method: "POST", path: "voice", scopes: operate, bytes: wav() })).json).toEqual({ heard: "what needs me", reply: "ok" });
    expect((await handlePhone(deps, { method: "POST", path: "voice", scopes: operate, bytes: new Uint8Array(100) })).status).toBe(400);
    expect(calls).toEqual(["say what is running", "say what needs me"]);
  });

  it("says 501 when the server cannot transcribe", async () => {
    const { deps } = make();
    const off: PhoneDeps = { ...deps, transcribe: async () => ({ ok: false, why: "Voice is not available on this server: it has no speech model here. Type instead." }) };
    expect(await handlePhone(off, { method: "POST", path: "voice", scopes: operate, bytes: wav() })).toMatchObject({ status: 501 });
  });
});
