import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const SCRIPT = NodeURL.fileURLToPath(new URL("./cloud-logins.sh", import.meta.url));
const DAY = 86_400_000;
// A fixed moment, handed to the script, so no test depends on the clock.
const NOW = 1_800_000_000_000;

/** Runs the script over fake account folders with a fake `claude`; no real token, address or network. */
const run = (accounts) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cloud-logins-"));
  const bin = NodePath.join(root, "bin");
  NodeFS.mkdirSync(bin);
  NodeFS.writeFileSync(
    NodePath.join(bin, "claude"),
    '#!/bin/sh\nif grep -q LOGGED_OUT "$CLAUDE_CONFIG_DIR/.credentials.json" 2>/dev/null; then echo \'{"loggedIn":false}\'; else echo \'{"loggedIn":true}\'; fi\n',
    { mode: 0o755 },
  );
  const folders = NodePath.join(root, "accounts");
  for (const [name, creds] of Object.entries(accounts)) {
    NodeFS.mkdirSync(NodePath.join(folders, name), { recursive: true });
    if (creds !== null) NodeFS.writeFileSync(NodePath.join(folders, name, ".credentials.json"), JSON.stringify(creds));
  }
  const out = NodePath.join(root, "state", "cloud-logins.json");
  NodeChildProcess.execFileSync("bash", [SCRIPT], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BATON_CLOUD_DIR: folders, BATON_CLOUD_LOGINS_FILE: out, BATON_NOW: String(NOW / 1000) },
  });
  return { report: JSON.parse(NodeFS.readFileSync(out, "utf8")), history: NodeFS.readFileSync(NodePath.join(root, "state", "cloud-logins.history"), "utf8") };
};
const creds = (accessHours, refreshDays, extra = {}) => ({
  claudeAiOauth: { accessToken: "fake", refreshToken: "fake", expiresAt: NOW + accessHours * 3_600_000, refreshTokenExpiresAt: NOW + refreshDays * DAY, ...extra },
});

NodeTest.test("the login lasts until the refresh token, not the access token", () => {
  const { report } = run({
    healthy: creds(7, 27),
    soon: creds(7, 3),
    edge: creds(7, 5.5),
    gone: { claudeAiOauth: { ...creds(7, 20).claudeAiOauth, note: "LOGGED_OUT" } },
    never: null,
    shortaccess: creds(1, 20),
  });
  const by = Object.fromEntries(report.accounts.map((a) => [a.account, a]));
  NodeAssert.equal(by.healthy.state, "ok", "an access token that lasts hours must not read as renew-soon");
  NodeAssert.ok(by.healthy.loginExpiresInDays >= 26 && by.healthy.loginExpiresInDays <= 27);
  NodeAssert.equal(by.shortaccess.state, "ok");
  NodeAssert.equal(by.soon.state, "renew-soon");
  NodeAssert.equal(by.edge.state, "ok");
  NodeAssert.equal(by.gone.state, "expired");
  NodeAssert.equal(by.never.state, "not-logged-in");
  NodeAssert.ok(by.healthy.accessTokenExpiresInHours >= 6);
  NodeAssert.ok(Number.isFinite(report.checkedAt));
});

NodeTest.test("writes one history line per account with times only, never a token or an address", () => {
  const { history, report } = run({ one: creds(7, 20), two: creds(7, 2) });
  NodeAssert.equal(history.trim().split("\n").length, 2);
  NodeAssert.match(history, /^\d+ one ok access=\d+ refresh=\d+$/m);
  NodeAssert.doesNotMatch(history + JSON.stringify(report), /fake|@/);
});

NodeTest.test("a credentials file without a refresh time still reports whether the login works", () => {
  const { report } = run({ old: { claudeAiOauth: { accessToken: "fake", expiresAt: NOW + 3_600_000 } } });
  NodeAssert.equal(report.accounts[0].state, "ok");
  NodeAssert.equal(report.accounts[0].loginExpiresInDays, undefined);
});
