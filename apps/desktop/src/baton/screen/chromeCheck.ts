// @effect-diagnostics nodeBuiltinImport:off
/**
 * Is Claude in Chrome set up on this computer? One question, one plain line (D3). Two facts are read:
 * the extension is installed in a Chrome profile, and its native host is listening (a named pipe on
 * Windows, a socket in the temp folder elsewhere). Reading them changes nothing and starts nothing.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** The extension's id in the Chrome Web Store. */
export const CLAUDE_CHROME_EXTENSION_ID = "fcoeoabgfenejglbffodgkkbkcdhcgfn";

export type ChromeState = "ready" | "no-extension" | "not-connected" | "unsupported";

export interface ChromeCheck {
  readonly state: ChromeState;
  /** One line a person can read aloud. */
  readonly message: string;
}

export interface ChromeProbe {
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly user: string;
  readonly tmp: string;
  readonly list: (dir: string) => ReadonlyArray<string>;
  readonly exists: (path: string) => boolean;
}

export const realProbe = (platform: string): ChromeProbe => ({
  platform,
  env: process.env,
  home: NodeOS.homedir(),
  user: NodeOS.userInfo().username,
  tmp: NodeOS.tmpdir(),
  list: (dir) => {
    try {
      return NodeFS.readdirSync(dir);
    } catch {
      return [];
    }
  },
  exists: (path) => NodeFS.existsSync(path),
});

const chromeRoots = (p: ChromeProbe): ReadonlyArray<string> =>
  p.platform === "win32"
    ? [
        NodePath.join(
          p.env["LOCALAPPDATA"] ?? NodePath.join(p.home, "AppData", "Local"),
          "Google",
          "Chrome",
          "User Data",
        ),
      ]
    : p.platform === "darwin"
      ? [NodePath.join(p.home, "Library", "Application Support", "Google", "Chrome")]
      : [NodePath.join(p.home, ".config", "google-chrome")];

const extensionInstalled = (p: ChromeProbe): boolean =>
  chromeRoots(p).some((root) =>
    p
      .list(root)
      .some(
        (profile) =>
          (profile === "Default" || profile.startsWith("Profile ")) &&
          p.exists(NodePath.join(root, profile, "Extensions", CLAUDE_CHROME_EXTENSION_ID)),
      ),
  );

const hostListening = (p: ChromeProbe): boolean =>
  p.platform === "win32"
    ? p.list("\\\\.\\pipe\\").some((name) => name.startsWith("claude-mcp-browser-bridge"))
    : p
        .list(NodePath.join(p.tmp, `claude-mcp-browser-bridge-${p.user}`))
        .some((name) => name.endsWith(".sock"));

export const checkChrome = (p: ChromeProbe): ChromeCheck => {
  if (p.platform !== "win32" && p.platform !== "darwin" && p.platform !== "linux") {
    return { state: "unsupported", message: "Chrome control is not available on this system." };
  }
  if (!extensionInstalled(p)) {
    return {
      state: "no-extension",
      message:
        "Claude in Chrome is not installed in Chrome. Install the extension from the Chrome Web Store and sign in to it.",
    };
  }
  if (!hostListening(p)) {
    return {
      state: "not-connected",
      message:
        "The Chrome extension is installed but not connected. Open Chrome and the extension, and check it is signed in.",
    };
  }
  return { state: "ready", message: "Chrome is connected." };
};
