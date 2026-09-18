import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ChatAttachment, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";

export type TextGenerationProvider = "codex" | "claudeAgent" | "cursor" | "grok" | "opencode";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  /** When true, the model also returns a semantic branch name for the change. */
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
  /** Only present when `includeBranch` was set on the input. */
  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  changeRequestTemplate?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  /** Present when replacing an existing title from the current thread history. */
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
}

export interface FabricIntentInterpretationInput {
  /** The sentence, verbatim. */
  readonly sentence: string;
  /** Everything the model is allowed to know: names and ids, no thread contents. */
  readonly prompt: string;
  /** What model and provider to use. Fabric picks the cheapest tier that classifies. */
  readonly modelSelection: ModelSelection;
}

/**
 * The model's answer, flat and nullable.
 *
 * Deliberately `unknown`-free but also deliberately unvalidated here: the
 * driver's only job is to get a shaped answer back. Whether the ids in it exist
 * is Fabric's question, and `@t3tools/shared/fabricIntentModel` answers it.
 */
export interface FabricIntentInterpretationResult {
  readonly kind: string;
  readonly statusQuestion: string | null;
  readonly workSessionId: string | null;
  readonly projectId: string | null;
  readonly providerInstanceId: string | null;
  readonly title: string | null;
  readonly message: string | null;
  readonly firingId: string | null;
  readonly confirmed: boolean | null;
  readonly description: string;
  readonly confidence: string;
  readonly question: string | null;
}

export interface FabricSynopsisInput {
  /** Recent turns from the thread, oldest first, already trimmed by the caller. */
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
}

export interface FabricSynopsisResult {
  /** What it is doing right now, one short sentence. */
  readonly currentAction: string;
  /** What happens next, one short sentence. */
  readonly next: string;
}

/**
 * TextGeneration - Service tag for commit and change request text generation.
 */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    /**
     * Generate a commit message from staged change context.
     */
    readonly generateCommitMessage: (
      input: CommitMessageGenerationInput,
    ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

    /**
     * Generate change request title/body from branch and diff context.
     */
    readonly generatePrContent: (
      input: PrContentGenerationInput,
    ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

    /**
     * Generate a concise branch name from a user message.
     */
    readonly generateBranchName: (
      input: BranchNameGenerationInput,
    ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

    /** Generate a concise thread title from a first message or thread history. */
    readonly generateThreadTitle: (
      input: ThreadTitleGenerationInput,
    ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

    /**
     * Read one sentence into one Fabric command (`DECISIONS.md` D50).
     *
     * Optional on purpose. Only the drivers that can run a cheap structured
     * one-shot implement it, and Fabric refuses by name when the chosen account
     * cannot — which is a better answer than a build that will not compile
     * because a provider nobody uses for this lacks a method.
     */
    readonly interpretFabricIntent?: (
      input: FabricIntentInterpretationInput,
    ) => Effect.Effect<FabricIntentInterpretationResult, TextGenerationError>;

    /** Write the two sentences of a §11 synopsis from a thread's recent turns (D51). */
    readonly writeFabricSynopsis?: (
      input: FabricSynopsisInput,
    ) => Effect.Effect<FabricSynopsisResult, TextGenerationError>;
  }
>()("t3/textGeneration/TextGeneration") {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "interpretFabricIntent"
  | "writeFabricSynopsis";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  return TextGeneration.of({
    generateCommitMessage: (input) =>
      resolveInstance(registry, "generateCommitMessage", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateCommitMessage(input)),
      ),
    generatePrContent: (input) =>
      resolveInstance(registry, "generatePrContent", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generatePrContent(input)),
      ),
    generateBranchName: (input) =>
      resolveInstance(registry, "generateBranchName", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateBranchName(input)),
      ),
    generateThreadTitle: (input) =>
      resolveInstance(registry, "generateThreadTitle", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) =>
          Effect.gen(function* () {
            const linkedContext =
              input.linkedContext ??
              (yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
                Effect.provideService(
                  SourceControlProviderRegistry.SourceControlProviderRegistry,
                  sourceControl,
                ),
              ));
            return yield* textGeneration.generateThreadTitle({ ...input, linkedContext });
          }),
        ),
      ),
    interpretFabricIntent: (input) =>
      resolveInstance(registry, "interpretFabricIntent", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) =>
          textGeneration.interpretFabricIntent
            ? textGeneration.interpretFabricIntent(input)
            : Effect.fail(
                new TextGenerationError({
                  operation: "interpretFabricIntent",
                  detail: `Provider instance '${input.modelSelection.instanceId}' cannot read a sentence into a command.`,
                }),
              ),
        ),
      ),
    writeFabricSynopsis: (input) =>
      resolveInstance(registry, "writeFabricSynopsis", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) =>
          textGeneration.writeFabricSynopsis
            ? textGeneration.writeFabricSynopsis(input)
            : Effect.fail(
                new TextGenerationError({
                  operation: "writeFabricSynopsis",
                  detail: `Provider instance '${input.modelSelection.instanceId}' cannot write a synopsis.`,
                }),
              ),
        ),
      ),
  });
});

export const layer = Layer.effect(TextGeneration, make);
