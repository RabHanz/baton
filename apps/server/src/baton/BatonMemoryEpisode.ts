// @effect-diagnostics globalDate:off globalDateInEffect:off
/** The day's episode (D150): what he talked about and which jobs moved, as one short memory that decays like any episode. */
import * as Effect from "effect/Effect";

import { BatonJobService } from "./BatonJobService.ts";
import { BatonMemoryService } from "./BatonMemoryService.ts";

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const dailyEpisode = Effect.fn("BatonMemoryReactor.dailyEpisode")(function* (nowMs: number) {
  const memory = yield* BatonMemoryService;
  const day = dayOf(nowMs);
  const said = yield* memory.talks(day);
  const since = new Date(nowMs - 86_400_000).toISOString();
  const jobs = (yield* (yield* BatonJobService).allTerms()).filter((t) => t.updatedAt >= since);
  if (said.length === 0 && jobs.length === 0) return null;
  const parts = [
    said.length === 0 ? null : `Talked about: ${said.slice(0, 6).join("; ")}.`,
    jobs.length === 0
      ? null
      : `Jobs: ${jobs.slice(0, 4).map((j) => `${j.goal.slice(0, 50)} (${j.phase.replace("_", " ")})`).join("; ")}.`,
  ].filter((x): x is string => x !== null);
  return yield* memory
    .add({ kind: "episode", text: `${day}. ${parts.join(" ")}`.slice(0, 500), source: "job", sourceRef: `day:${day}` })
    .pipe(Effect.orElseSucceed(() => null));
});
