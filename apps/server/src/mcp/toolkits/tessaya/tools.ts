/**
 * Tessaya's toolkit on T3's /mcp (docs/user/outside-agents.md): what an outside agent may read, through the same server
 * methods the clients use. Reads only; acting goes through the Director's gate on the desktop, never through here.
 */
import {
  BatonCatalogListInput,
  BatonCatalogListResult,
  BatonJobListResult,
  BatonMemorySearchResult,
  BatonRecordListInput,
  BatonRecordListResult,
  OrchestrationRuleListInput,
  OrchestrationRuleListResult,
  WatchResult,
} from "@t3tools/baton-contracts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};
// An empty struct serializes as `anyOf [object, array]`, which some providers reject.
const NoInput = Schema.Struct({ detail: Schema.optional(Schema.Boolean) });
/** Shown to agents signed in from outside; T3's own thread agents keep their context for their work. */
const outsideAgentsOnly = (): boolean => {
  const fiber = Fiber.getCurrent();
  const scope =
    fiber && Context.getOrUndefined(fiber.context, McpInvocationContext.McpInvocationContext);
  return scope?.client !== undefined;
};
const JobsTool = Tool.make("tessaya_jobs", {
  ...shared,
  description:
    "List Tessaya's jobs on this computer: each job's goal, status, parts and who it waits on.",
  parameters: NoInput,
  success: BatonJobListResult,
})
  .annotate(McpSchema.EnabledWhen, outsideAgentsOnly)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);
const WatchTool = Tool.make("tessaya_watch", {
  ...shared,
  description:
    "Tessaya's watch report: running work that looks stuck, failed or waiting for the Director.",
  parameters: NoInput,
  success: WatchResult,
})
  .annotate(McpSchema.EnabledWhen, outsideAgentsOnly)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);
const RecordTool = Tool.make("tessaya_record", {
  ...shared,
  description:
    "Tessaya's Record, newest first: what happened, who did it and for which project. Filter by since (ISO time), project or kind.",
  parameters: BatonRecordListInput,
  success: BatonRecordListResult,
})
  .annotate(McpSchema.EnabledWhen, outsideAgentsOnly)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);
const MemorySearchTool = Tool.make("tessaya_memory_search", {
  ...shared,
  description:
    "Search what Tessaya remembers about the Director's work and preferences. Walled projects' memories are never shown here.",
  parameters: Schema.Struct({
    text: Schema.String.check(Schema.isMaxLength(500)),
    limit: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  }),
  success: BatonMemorySearchResult,
})
  .annotate(McpSchema.EnabledWhen, outsideAgentsOnly)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);
const RulesTool = Tool.make("tessaya_rules", {
  ...shared,
  description:
    "List Tessaya's standing rules (when this happens, do that) and their recent firings.",
  parameters: OrchestrationRuleListInput,
  success: OrchestrationRuleListResult,
})
  .annotate(McpSchema.EnabledWhen, outsideAgentsOnly)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);
const SessionsTool = Tool.make("tessaya_sessions", {
  ...shared,
  description:
    "List the coding agent sessions on this computer (Claude Code, Codex and others), newest first. `query` matches title or folder.",
  parameters: BatonCatalogListInput,
  success: BatonCatalogListResult,
})
  .annotate(McpSchema.EnabledWhen, outsideAgentsOnly)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const TessayaToolkit = Toolkit.make(
  JobsTool,
  WatchTool,
  RecordTool,
  MemorySearchTool,
  RulesTool,
  SessionsTool,
);
