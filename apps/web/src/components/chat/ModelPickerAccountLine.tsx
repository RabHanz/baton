import type { ProviderInstanceEntry } from "../../providerInstances";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";

/**
 * Which account this thread will run as, at the moment the model is chosen.
 *
 * The instance rail is icons with a tooltip, so with three Claude logins on one
 * machine the only way to know which one a thread would use was to start it and
 * look at the fleet row afterwards. The address is redacted until asked for —
 * the same treatment the settings card and the fleet rows give it, because a
 * composer is on screen while people screen-share.
 */
export function ModelPickerAccountLine({
  entry,
}: {
  readonly entry: ProviderInstanceEntry | undefined;
}) {
  const email = entry?.snapshot.auth.email?.trim() ?? "";
  if (entry === undefined || email.length === 0) return null;
  return (
    <div
      data-testid="model-picker-account"
      className="flex min-w-0 items-baseline gap-1.5 px-2 pt-2 text-[11px] leading-4 text-muted-foreground"
    >
      <span className="shrink-0">Runs as</span>
      <span className="min-w-0 truncate font-medium text-foreground/80">{entry.displayName}</span>
      <RedactedSensitiveText
        value={email}
        ariaLabel="Toggle account email visibility"
        revealTooltip="Click to reveal the account this thread will run as"
        hideTooltip="Click to hide the account"
        className="min-w-0 max-w-full truncate"
      />
    </div>
  );
}
