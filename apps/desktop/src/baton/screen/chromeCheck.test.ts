import { describe, expect, it } from "vite-plus/test";

import { checkChrome, CLAUDE_CHROME_EXTENSION_ID, type ChromeProbe } from "./chromeCheck.ts";

const probe = (platform: string, present: ReadonlyArray<string>): ChromeProbe => ({
  platform,
  env: { LOCALAPPDATA: "C:\\Users\\sam\\AppData\\Local" },
  home: "/home/sam",
  user: "sam",
  tmp: "/tmp",
  exists: (p) => present.some((x) => p.replaceAll("\\", "/").endsWith(x)),
  list: (dir) =>
    dir.includes("pipe")
      ? present.filter((x) => x.startsWith("claude-mcp"))
      : dir.includes("claude-mcp-browser-bridge")
        ? present.filter((x) => x.endsWith(".sock"))
        : dir.includes("Chrome") || dir.includes("google-chrome")
          ? ["Default", "Crashpad"]
          : [],
});
const EXT = `Default/Extensions/${CLAUDE_CHROME_EXTENSION_ID}`;

describe("is Claude in Chrome set up", () => {
  it("says what to do when the extension is missing, or installed but not connected, in one line each", () => {
    const missing = checkChrome(probe("linux", []));
    expect(missing.state).toBe("no-extension");
    expect(missing.message).toContain("Install the extension");
    const idle = checkChrome(probe("linux", [EXT]));
    expect(idle.state).toBe("not-connected");
    expect(idle.message.split("\n")).toHaveLength(1);
  });
  it("is ready when the extension is there and its host is listening, on each system", () => {
    expect(checkChrome(probe("linux", [EXT, "laptop.sock"])).state).toBe("ready");
    expect(checkChrome(probe("win32", [EXT, "claude-mcp-browser-bridge-sam"])).state).toBe("ready");
    expect(checkChrome(probe("darwin", [EXT, "a.sock"])).state).toBe("ready");
    expect(checkChrome(probe("freebsd", [EXT, "a.sock"])).state).toBe("unsupported");
  });
});
