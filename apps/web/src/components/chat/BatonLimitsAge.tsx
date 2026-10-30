/**
 * How old a limits reading is (D92). A setup token's windows come from Baton's five-minute probe, so
 * they lag the account, and a stopped probe would otherwise look like a quiet account.
 */
import { cn } from "~/lib/utils";

/** Three missed five-minute ticks: the same point at which cswap's hold on the reading lapses. */
const STALE_AFTER_MS = 15 * 60_000;

export function limitsAge(
  checkedAt: string,
  now: number,
): { readonly text: string; readonly stale: boolean } | null {
  const age = now - Date.parse(checkedAt);
  if (!Number.isFinite(age)) return null;
  const minutes = Math.max(0, Math.floor(age / 60_000));
  const ago =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} min ago`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)} h ago`
          : `${Math.floor(minutes / 1440)} d ago`;
  return age > STALE_AFTER_MS
    ? { text: `Stale: last read ${ago}`, stale: true }
    : { text: `Read ${ago}`, stale: false };
}

export function BatonLimitsAge(props: {
  readonly checkedAt: string;
  readonly now: number;
  readonly className?: string;
}) {
  const age = limitsAge(props.checkedAt, props.now);
  if (age === null) return null;
  return (
    <span
      data-testid="limits-age"
      className={cn(
        "text-2xs",
        age.stale ? "text-warning-foreground" : "text-muted-foreground",
        props.className,
      )}
    >
      {age.text}
    </span>
  );
}
