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
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EnvironmentId, FabricIntentResolution } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { previewResolution } from "../../fabricIntentView";
import { fabricWorkSessions } from "../../state/fabricWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";

/** Long enough that typing does not round-trip per keystroke. */
const PREVIEW_DEBOUNCE_MS = 400;

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
        setText("");
        props.onRan();
        return;
      }
      // The sentence resolved and the command failed. Saying so beats an empty
      // input that looks like it worked.
      setReply("That could not be done. Nothing changed.");
    });
  };

  const preview =
    resolution === null || resolution.text !== text.trim()
      ? null
      : previewResolution(resolution.resolution);

  return (
    <div className="px-2 pb-1 pt-1">
      <input
        type="text"
        data-testid="sidebar-intent-input"
        value={text}
        disabled={running}
        placeholder="What needs me?"
        aria-label="Say what you want"
        onChange={(event) => {
          setText(event.target.value);
          setReply(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submit();
        }}
        className="w-full rounded bg-sidebar-accent/40 px-1.5 py-1 text-xs leading-4 text-sidebar-foreground placeholder:text-sidebar-muted-foreground focus:outline-none"
      />
      {preview === null ? null : (
        <p
          data-testid="sidebar-intent-preview"
          className={cn(
            "truncate pt-0.5 text-[11px] leading-4",
            preview.tone === "refused"
              ? "text-sidebar-destructive-foreground"
              : "text-sidebar-muted-foreground",
            preview.weighty && "text-sidebar-foreground",
          )}
        >
          {preview.tone === "will" ? `↵ ${preview.line}` : preview.line}
        </p>
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
