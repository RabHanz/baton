import { describe, expect, it } from "vite-plus/test";

import { agentMessageFrom } from "./AgentMessageFrom.ts";

const thread = (title: string, root: string) => ({ title, lineage: { rootThreadId: root } });

describe("agentMessageFrom", () => {
  it("names a peer agent, another machine, and stays off his own sends and delegation trees", () => {
    const target = thread("Fix login", "t-login");
    expect(
      agentMessageFrom({ sender: thread("Release", "t-rel"), target, client: undefined }),
    ).toBe('From the agent in the thread "Release", via Tessaya (another agent, not the user):');
    expect(
      agentMessageFrom({ sender: thread("Child", "t-login"), target, client: undefined }),
    ).toBeNull();
    expect(
      agentMessageFrom({
        sender: undefined,
        target,
        client: { label: "office-mac", linked: true },
      }),
    ).toBe("From an agent on office-mac, via Tessaya (another agent, not the user):");
    expect(agentMessageFrom({ sender: undefined, target, client: { label: "phone" } })).toBeNull();
    expect(agentMessageFrom({ sender: undefined, target, client: undefined })).toBeNull();
  });
});
