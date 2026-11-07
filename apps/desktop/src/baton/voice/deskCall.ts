/**
 * A job, watch or memory request as one call to this machine's own server, for while T3's window is closed
 * (GEN-6). The arguments are shaped as the sidebar shapes them; the server decodes and checks them. Null for a
 * request only the window can answer: starting a job (it picks the project and worker), handoff, sync, import.
 */
import type { BatonJobBridgeRequest } from "@t3tools/baton-contracts";

const MEMORY_OPS = new Set([
  "list",
  "history",
  "restore",
  "search",
  "add",
  "edit",
  "pin",
  "forget",
  "accept",
  "recall",
  "used",
  "export",
  "learn",
]);

export const deskCall = (body: {
  readonly kind: string;
  readonly op?: unknown;
  readonly args?: unknown;
}): { readonly method: string; readonly input: unknown } | null => {
  const args = (body.args ?? {}) as Readonly<Record<string, unknown>>;
  if (body.kind === "memory") {
    return typeof body.op === "string" && MEMORY_OPS.has(body.op)
      ? { method: `baton.memory.${body.op}`, input: args }
      : null;
  }
  if (body.kind !== "job") return null;
  const text = (key: string) => (typeof args[key] === "string" ? args[key] : "");
  const id = { id: text("id") };
  switch (body.op as BatonJobBridgeRequest["op"]) {
    case "list":
      return { method: "baton.job.list", input: {} };
    case "watch":
      return { method: "baton.watch.get", input: {} };
    case "agree":
      return { method: "baton.job.agree", input: id };
    case "stop":
      return { method: "baton.job.stop", input: id };
    case "split":
      return {
        method: "baton.job.split",
        input: { ...id, parts: Array.isArray(args["parts"]) ? args["parts"] : [] },
      };
    case "schedule":
      return {
        method: "baton.job.schedule",
        input: {
          ...id,
          everyMinutes: typeof args["everyMinutes"] === "number" ? args["everyMinutes"] : null,
        },
      };
    case "refine":
      return {
        method: "baton.job.refine",
        input: {
          ...id,
          text: text("text"),
          via: args["via"] === "text" ? "text" : "voice",
          widens: args["widens"] === true,
          ...(args["note"] === true ? { note: true } : {}),
        },
      };
    case "grant":
    case "revoke":
      return { method: `baton.job.${String(body.op)}`, input: { ...id, channel: text("channel") } };
    default:
      return null;
  }
};
