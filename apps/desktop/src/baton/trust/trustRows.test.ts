import { describe, expect, it } from "vite-plus/test";

import { lastUsed, parseTrustLogs, trustAction, trustControls, type TrustData } from "./trustRows.ts";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const turns = [
  { at: "2026-11-03T11:00:00Z", kind: "action", tool: "screen_capture", outcome: "allowed" },
  { at: "2026-11-03T11:30:00Z", kind: "action", tool: "weave_send", action: "to build", outcome: "allowed" },
  { at: "2026-11-03T11:40:00Z", kind: "turn", transcript: "never shown" },
  { at: "2026-11-03T10:00:00Z", kind: "action", tool: "mcp__claude-in-chrome__navigate", outcome: "refused" },
]
  .map((l) => JSON.stringify(l))
  .join("\n");
const play = JSON.stringify({ at: "2026-11-03T07:00:00Z", kind: "playbook", playbook: "ci_look", text: "ci on x: started" });
const social = JSON.stringify({ at: "2026-11-03T09:00:00Z", host: "x.com", tool: "click", action: "post", outcome: "asked" });
const vault = JSON.stringify({ at: "2026-11-03T08:00:00Z", name: "github", purpose: "login", target: "github.com", outcome: "used" });

const data = (over: Partial<TrustData> = {}): TrustData => ({
  screenAlways: true,
  chrome: false,
  social: true,
  act: false,
  vault: "unlocked",
  grants: [{ jobId: "j1", title: "Site", channel: "retry", since: "2026-11-01T00:00:00Z" }],
  weaveHosts: ["office"],
  playbooks: [{ id: "ci_look", title: "When a build fails", what: "Looks.", perDay: 3, on: false }],
  entries: parseTrustLogs({ turns: `${turns}\n${play}`, social: `${social}\ngarbage{`, vault }),
  filter: "all",
  ...over,
});

describe("trust page", () => {
  it("merges the logs newest first and keeps only action lines from the turn log", () => {
    const entries = parseTrustLogs({ turns, social, vault });
    expect(entries.map((e) => e.kind)).toEqual(["weave", "action", "action", "social", "vault"]);
    expect(JSON.stringify(entries)).not.toContain("never shown");
  });

  it("knows when each permission was last used, ignoring refused calls", () => {
    const used = lastUsed(parseTrustLogs({ turns, social, vault }));
    expect(used.screen).toBe("2026-11-03T11:00:00Z");
    expect(used.chrome).toBeUndefined();
    expect(used.weave).toBe("2026-11-03T11:30:00Z");
    expect(used.vault).toBe("2026-11-03T08:00:00Z");
  });

  it("offers a revoke only for what is on, and one per standing grant", () => {
    const ids = trustControls(data(), NOW).map((c) => `${c.kind}:${c.id}`);
    expect(ids).toContain("action:trust.revoke:screen");
    expect(ids).toContain("action:trust.revoke:social");
    expect(ids).toContain("action:trust.revoke:vault");
    expect(ids).toContain("action:trust.revoke:grant:j1:retry");
    expect(ids).toContain("check:trust.off:chrome");
    expect(ids).not.toContain("action:trust.revoke:chrome");
  });

  it("lists each playbook as a toggle that is off until turned on", () => {
    const row = trustControls(data(), NOW).find((c) => c.id === "trust.playbook:ci_look");
    expect(row?.kind === "toggle" && row.on).toBe(false);
    expect(trustAction("trust.playbook:ci_look", true)).toEqual({ kind: "playbook", id: "ci_look", on: true });
  });

  it("filters the log", () => {
    const logRows = (filter: TrustData["filter"]) =>
      trustControls(data({ filter }), NOW).filter((c) => c.id.startsWith("trust.log:"));
    expect(logRows("all")).toHaveLength(6);
    expect(logRows("playbook")).toHaveLength(1);
    expect(logRows("vault")).toHaveLength(1);
    expect(logRows("weave")).toHaveLength(1);
  });

  it("reads clicks", () => {
    expect(trustAction("trust.revoke:chrome", true)).toEqual({ kind: "revoke", what: "chrome" });
    expect(trustAction("trust.revoke:grant:job-1:pr_comment", null)).toEqual({
      kind: "grant",
      jobId: "job-1",
      channel: "pr_comment",
    });
    expect(trustAction("trust.filter", "social")).toEqual({ kind: "filter", filter: "social" });
    expect(trustAction("trust.filter", "nope")).toBeNull();
  });
});

describe("trust by voice", () => {
  it("describes the permissions and today's activity in plain words", async () => {
    const { describeToday, describeTrust, permissionFromWords } = await import("./trustRows.ts");
    const said = describeTrust(data(), NOW);
    expect(said).toContain("Your Chrome: off.");
    expect(said).toContain("Looking at your screen without asking: on (last used");
    expect(said).toContain("nothing, all playbooks are off");
    expect(describeToday([], new Date(NOW))).toContain("Nothing yet today");
    expect(describeToday(data().entries, new Date("2026-11-03T12:00:00Z"))).toContain("Today:");
    expect(permissionFromWords("turn off Chrome")).toBe("chrome");
    expect(permissionFromWords("the weather")).toBeNull();
  });
});
