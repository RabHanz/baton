/**
 * One line, above the Fleet: say what you want.
 *
 * This is where the Director's dictation lands today. iOS dictation, Wispr
 * Flow, a DJI receiver through his own speech-to-text — all of them produce
 * text into a focused field, and the fork's job starts at the text. There is no
 * microphone in here and there should not be one: a phone, a laptop and a
 * keyboard should mean the same thing to the environment.
 *
 * The line under the input is the confirmation step, not decoration. A surface
 * fed by dictation mishears, and the difference between a useful assistant and
 * a dangerous one is whether "Tell Claude on Scheduler: run the migration
 * tests" can be read and stopped before it happens.
 *
 * One sentence never leaves this component: dictation. "Dictate: thanks, I'll
 * send the revised contract tomorrow" is an email to somebody else, not work,
 * and an environment has no business receiving it or writing it to an intent
 * log. The client classifies it first and refuses by name when there is
 * nowhere to put the words (§12.3, §18).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EnvironmentId, FabricIntentResolution } from "@t3tools/contracts";
import { classifyDictation } from "@t3tools/shared/fabricDictation";

import { cn } from "~/lib/utils";
import { dictationModeLabel, dictationRefusal } from "../../fabricContextView";
import { previewResolution } from "../../fabricIntentView";
import { fabricWorkSessions } from "../../state/fabricWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";

/** Long enough that typing does not round-trip per keystroke. */
const PREVIEW_DEBOUNCE_MS = 400;

/**
 * Grammar refusals a model is allowed to read a second time (D50).
 *
 * The same list the environment enforces; it is repeated here only so the
 * client knows when to offer the second reading, and a client that gets it
 * wrong is refused by the server rather than obeyed.
 */
const OPEN_TO_MODEL: ReadonlySet<string> = new Set([
  "unrecognised",
  "rule_not_understood",
  "unknown_target",
]);

export interface FabricIntentBarProps {
  readonly environmentId: EnvironmentId;
  /** §14 rung 3: what the user is looking at, when the client knows. */
  readonly focusedWorkSessionId: string | null;
  /** Called after a sentence runs, so the log and the fleet re-read. */
  readonly onRan: () => void;
}

export function FabricIntentBar(props: FabricIntentBarProps): ReactNode {
  const [text, setText] = useState("");
  // The words the preview belongs to travel with it. A preview for a sentence
  // the user has since changed is worse than no preview: this line is the
  // confirmation step, and it must never describe something else.
  const [resolution, setResolution] = useState<{
    readonly text: string;
    readonly resolution: FabricIntentResolution;
  } | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /**
   * A model's reading of the current sentence, once it has been asked for.
   * Carries its own text for the same reason the grammar preview does: a
   * reading of a sentence the user has since changed must never be what runs.
   */
  const [modelReading, setModelReading] = useState<{
    readonly text: string;
    readonly resolution: FabricIntentResolution;
  } | null>(null);
  const [reading, setReading] = useState(false);
  /** §12.3's mode. While it is on, ordinary words are text, not instructions. */
  const [dictating, setDictating] = useState(false);
  const resolveIntent = useAtomCommand(fabricWorkSessions.intentResolve, { reportFailure: false });
  const runIntent = useAtomCommand(fabricWorkSessions.intentRun, { reportFailure: false });
  const latest = useRef(0);

  // Resolve while typing. `intentResolve` is a read: it decides what the words
  // would mean and does none of it, which is why the preview can be live.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const ticket = latest.current + 1;
    latest.current = ticket;
    const timer = setTimeout(() => {
      void resolveIntent({
        environmentId: props.environmentId,
        input: {
          text: trimmed,
          focusedWorkSessionId: props.focusedWorkSessionId as never,
        },
      }).then((result) => {
        // A slower answer to an older sentence must not overwrite a newer one.
        if (latest.current !== ticket) return;
        setResolution(
          result._tag === "Success" ? { text: trimmed, resolution: result.value.resolution } : null,
        );
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, props.environmentId, props.focusedWorkSessionId, resolveIntent]);

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || running) return;

    // Dictation first, and it stops here. Nothing about these words reaches an
    // environment — not the text, not the fact that they were said.
    const dictation = classifyDictation(trimmed, { dictating });
    if (dictation.kind === "stop") {
      setDictating(false);
      setText("");
      setResolution(null);
      setReply("Stopped dictating.");
      return;
    }
    if (dictation.kind === "start" || dictation.kind === "text") {
      setDictating(dictation.kind === "start");
      setText("");
      setResolution(null);
      // This client has no field of its own to type into and cannot reach
      // another application's. Saying so by name is the whole of §18's
      // honesty requirement; saying nothing is the failure it is written
      // against.
      setReply(
        dictationRefusal({
          report: null,
          targetReason: "This client cannot type into another application from here.",
        }),
      );
      return;
    }

    const grammar = resolution?.text === trimmed ? resolution.resolution : null;
    const alreadyRead = modelReading?.text === trimmed ? modelReading.resolution : null;

    // First Enter on a sentence the grammar could not place: ask a model to
    // read it, and show what it understood. Nothing runs yet — the reading is
    // the confirmation step, and it is the whole reason a model on this path is
    // safe rather than a shortcut.
    if (
      alreadyRead === null &&
      !reading &&
      grammar !== null &&
      grammar.outcome === "refused" &&
      OPEN_TO_MODEL.has(grammar.refusal.reason)
    ) {
      setReading(true);
      void resolveIntent({
        environmentId: props.environmentId,
        input: {
          text: trimmed,
          focusedWorkSessionId: props.focusedWorkSessionId as never,
          allowModel: true,
        },
      }).then((result) => {
        setReading(false);
        if (result._tag !== "Success") {
          setReply("That could not be read.");
          return;
        }
        setModelReading({ text: trimmed, resolution: result.value.resolution });
      });
      return;
    }

    setRunning(true);
    void runIntent({
      environmentId: props.environmentId,
      input: {
        text: trimmed,
        focusedWorkSessionId: props.focusedWorkSessionId as never,
      },
    }).then((result) => {
      setRunning(false);
      if (result._tag === "Success") {
        setReply(result.value.reply);
        setResolution(null);
        setModelReading(null);
        setText("");
        props.onRan();
        return;
      }
      // The sentence resolved and the command failed. Saying so beats an empty
      // input that looks like it worked.
      setReply("That could not be done. Nothing changed.");
    });
  };

  // A model's reading of these exact words wins over the grammar's refusal of
  // them: it is newer, it is what the next Enter will run, and it is what the
  // user asked for by pressing Enter once already.
  const trimmedText = text.trim();
  const shown =
    modelReading !== null && modelReading.text === trimmedText
      ? modelReading.resolution
      : resolution !== null && resolution.text === trimmedText
        ? resolution.resolution
        : null;
  const preview = shown === null ? null : previewResolution(shown);
  const awaitingSecondEnter =
    modelReading !== null && modelReading.text === trimmedText && shown?.outcome === "resolved";

  return (
    <div className="px-2 pb-1 pt-1">
      {reading ? (
        <p
          data-testid="sidebar-intent-reading"
          className="pb-0.5 text-[11px] leading-4 text-sidebar-muted-foreground"
        >
          {/* A model read takes seconds, not milliseconds. Saying so beats an
              input that looks like it ignored the keypress. */}
          Reading that…
        </p>
      ) : null}
      {dictating ? (
        <p
          data-testid="sidebar-intent-dictating"
          className="pb-0.5 text-[11px] leading-4 text-sidebar-foreground"
        >
          {/* The mode is never invisible: dictation the user has forgotten is
              on is how a sentence meant for an agent ends up in an email. */}
          {dictationModeLabel(null)}
        </p>
      ) : null}
      <input
        type="text"
        data-testid="sidebar-intent-input"
        // What arms this field from a hotkey, a mic button, or an external
        // dictation tool that types into whatever has focus.
        data-fabric-intent-input="true"
        value={text}
        disabled={running}
        placeholder="What needs me?"
        aria-label="Say what you want"
        // A phone keyboard says "go" rather than "return", and a spoken
        // sentence is a sentence: capitalised, spell-checked, not autocompleted
        // against a form history it has no business in.
        enterKeyHint="go"
        inputMode="text"
        autoCapitalize="sentences"
        autoComplete="off"
        autoCorrect="on"
        spellCheck
        onChange={(event) => {
          setText(event.target.value);
          setReply(null);
          // A reading belongs to the words it read. Changing them discards it,
          // so the next Enter asks again rather than running something the user
          // is no longer looking at.
          setModelReading(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submit();
        }}
        className="w-full rounded bg-sidebar-accent/40 px-1.5 py-1 text-xs leading-4 text-sidebar-foreground placeholder:text-sidebar-muted-foreground focus:outline-none"
      />
      {preview === null ? null : (
        <>
          {awaitingSecondEnter ? (
            // Its own line, the way a fleet row gives its heading and its
            // detail a line each: at 256px the marker and the description
            // cannot share one without the description — the half that matters
            // — being the half that truncates.
            <p
              data-testid="sidebar-intent-marker"
              className="truncate pt-0.5 text-[11px] leading-4 text-sidebar-muted-foreground"
            >
              ↵ again to run
            </p>
          ) : null}
          <p
            data-testid="sidebar-intent-preview"
            className={cn(
              "truncate text-[11px] leading-4",
              awaitingSecondEnter ? "" : "pt-0.5",
              preview.tone === "refused"
                ? "text-sidebar-destructive-foreground"
                : "text-sidebar-muted-foreground",
              preview.weighty && "text-sidebar-foreground",
            )}
          >
            {preview.tone === "will" && !awaitingSecondEnter ? `↵ ${preview.line}` : preview.line}
          </p>
        </>
      )}
      {preview?.unplaced === null || preview === null ? null : (
        <p className="truncate text-[11px] leading-4 text-sidebar-muted-foreground">
          {`could not place: ${preview.unplaced}`}
        </p>
      )}
      {reply === null ? null : (
        <p
          data-testid="sidebar-intent-reply"
          className="pt-0.5 text-[11px] leading-4 text-sidebar-foreground"
        >
          {reply}
        </p>
      )}
    </div>
  );
}
