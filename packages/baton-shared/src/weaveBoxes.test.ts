import { describe, expect, it } from "vite-plus/test";

import { parseWeaveHosts, shellQuote, sshHerdr } from "./weaveBoxes.ts";

describe("weave hosts", () => {
  it("is off unless configured, and drops what could be an injection", () => {
    expect(parseWeaveHosts(undefined)).toEqual({ hosts: [], rejected: [] });
    const { hosts, rejected } = parseWeaveHosts(
      JSON.stringify([
        { name: "orbit", target: "dev@box", key: "~/.ssh/id", herdr: "/home/x/.local/bin/herdr" },
        { name: "bad", target: "-oProxyCommand=evil" },
        { name: "here", target: "a@b" },
        { name: "semi", target: "a@b; rm -rf /" },
      ]),
    );
    expect(hosts.map((h) => h.name)).toEqual(["orbit"]);
    expect(rejected).toEqual(["bad", "here", "semi"]);
  });
  it("quotes every argument for the remote shell", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    const cmd = sshHerdr(
      { name: "orbit", target: "dev@box", key: "/k", herdr: "/home/x/.local/bin/herdr" },
      ["pane", "send-text", "p1", "hi; rm -rf /"],
    );
    expect(cmd.args.slice(0, 5)).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-i"]);
    expect(cmd.args.at(-1)).toBe(
      `'/home/x/.local/bin/herdr' 'pane' 'send-text' 'p1' 'hi; rm -rf /'`,
    );
  });
});
