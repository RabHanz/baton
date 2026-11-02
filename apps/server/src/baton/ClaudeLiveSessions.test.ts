import { describe, expect, it } from "vite-plus/test";

import {
  herdrPaneRef,
  isTessayaOwnFolder,
  parseClaudeSessionDescriptor,
} from "./ClaudeLiveSessions.ts";

const descriptor = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    pid: 42,
    sessionId: "s-1",
    cwd: "/home/dev/p",
    kind: "interactive",
    entrypoint: "cli",
    name: "Ventureos",
    status: "busy",
    updatedAt: 1793006446893,
    ...over,
  });

const live = { alive: () => true, env: () => new Map<string, string>(), account: "signzart" };

describe("live Claude Code sessions from their own descriptors (D68)", () => {
  it("reads an interactive session with its account and state", () => {
    const session = parseClaudeSessionDescriptor(descriptor(), live);
    expect(session).toMatchObject({
      pid: 42,
      sessionId: "s-1",
      status: "busy",
      account: "signzart",
      herdrPane: null,
    });
  });

  it("skips -p workers, dead processes and unreadable files", () => {
    expect(parseClaudeSessionDescriptor(descriptor({ kind: "print" }), live)).toBeNull();
    expect(parseClaudeSessionDescriptor(descriptor(), { ...live, alive: () => false })).toBeNull();
    expect(parseClaudeSessionDescriptor("{nope", live)).toBeNull();
    expect(parseClaudeSessionDescriptor(descriptor({ entrypoint: "sdk-cli" }), live)).toBeNull();
  });

  it("knows which Herdr pane a session lives in", () => {
    expect(
      herdrPaneRef(
        new Map([
          ["HERDR_PANE_ID", "w1:p2"],
          ["HERDR_SESSION", "default"],
        ]),
      ),
    ).toBe("w1:p2");
    expect(
      herdrPaneRef(
        new Map([
          ["HERDR_PANE_ID", "w1:p1"],
          ["HERDR_SESSION", "fab-api"],
        ]),
      ),
    ).toBe("fab-api~w1:p1");
    expect(herdrPaneRef(new Map())).toBeNull();
  });
});

describe("Tessaya's own helper sessions", () => {
  it("are told apart from the user's projects by their folder under the app's data directory", () => {
    expect(isTessayaOwnFolder("C:\\Users\\rabee\\.t3\\userdata")).toBe(true);
    expect(isTessayaOwnFolder("/home/dev/.t3/userdata/screen")).toBe(true);
    expect(isTessayaOwnFolder("D:\\Downloads\\Development\\3D-Printer")).toBe(false);
    expect(isTessayaOwnFolder("/home/dev/.t3x/work")).toBe(false);
    expect(isTessayaOwnFolder(null)).toBe(false);
  });
});
