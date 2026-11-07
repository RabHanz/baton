// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { MAX_USER_JOBS, type UserJob } from "@t3tools/baton-shared/userJobs";

import { createUserJobStore } from "./userJobStore.ts";

const job = (id: string): UserJob => ({
  id,
  title: "Morning CI check",
  instruction: "Check CI and tell me what broke",
  owner: "executive",
  trigger: { kind: "time", hour: 8, minute: 0, days: [] },
  tools: ["jobs_list"],
  on: true,
  proposed: false,
  missed: "once",
  createdAt: 0,
});

describe("his own standing jobs, kept on this computer", () => {
  it("adds, edits, switches and removes, and never holds more than the cap", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "user-jobs-"));
    const store = createUserJobStore(dir);
    expect(store.nextId()).toBe("user:1");
    expect(store.add(job(store.nextId()))).toEqual({ ok: true });
    expect(store.nextId()).toBe("user:2");
    expect(
      store.update("user:1", { on: false, instruction: "Check CI on tessaya only" }),
    ).toMatchObject({
      on: false,
      instruction: "Check CI on tessaya only",
    });
    expect(store.update("user:9", { on: true })).toBeNull();
    for (let i = 1; i < MAX_USER_JOBS; i += 1) store.add(job(store.nextId()));
    expect(store.add(job(store.nextId()))).toMatchObject({ ok: false });
    expect(store.remove("user:1")).toBe(true);
    expect(store.get("user:1")).toBeUndefined();
    expect(store.list()).toHaveLength(MAX_USER_JOBS - 1);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
});
