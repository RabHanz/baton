/**
 * The line an agent-to-agent message starts with, so the receiving agent can tell a peer from the
 * person. Never on his own sends, and never inside one delegation tree (a parent and its sub-tasks).
 * The tree is known only on this machine: a send forwarded from another one always gets the line.
 * A title or label is set by the sender, so it reaches the model quoted, never as bare text.
 */
interface Lineage {
  readonly id: string;
  readonly title: string;
  readonly lineage: { readonly rootThreadId: string };
}

export const agentMessageFrom = (input: {
  /** The sending thread on this machine, if an agent here sent it. */
  readonly sender: Lineage | undefined;
  readonly target: Lineage;
  /** The caller when it is not a thread here: another machine's link carries its name. */
  readonly client: { readonly label: string; readonly linked?: boolean | undefined } | undefined;
}): string | null => {
  if (input.sender !== undefined)
    return input.sender.lineage.rootThreadId === input.target.lineage.rootThreadId
      ? null
      : `From the agent in thread ${JSON.stringify(input.sender.title)} (threadId ${input.sender.id}), via Tessaya. It is another agent, not the user; to answer it, send to that thread with t3_thread_send.`;
  if (input.client === undefined) return null;
  return input.client.linked === true
    ? `From an agent on ${JSON.stringify(input.client.label)}, via Tessaya. It is another agent, not the user.`
    : `From the outside agent ${JSON.stringify(input.client.label)}, via Tessaya. It is another agent, not the user.`;
};

export const withAgentMessageFrom = (from: string | null, text: string): string =>
  from === null ? text : `${from}\n\n${text}`;
