/**
 * The project a directory belongs to, the same answer on every box (D72).
 *
 * Reuses T3's own `RepositoryIdentityResolver` (git remote → canonical key),
 * so a VentureOS checkout on signzart and one on onnyx are the same project
 * even when their paths differ. A directory with no remote falls back to its
 * folder name, which is weaker and is marked `dir:` so it never collides with
 * a repository key.
 */
import type { BatonProjectRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";

export const folderProjectRef = (cwd: string): BatonProjectRef => {
  const leaf =
    cwd
      .split("/")
      .filter((part) => part.length > 0)
      .pop() ?? cwd;
  return { key: `dir:${leaf.toLowerCase()}`, label: leaf };
};

export const projectRefFor = (cwd: string): Effect.Effect<BatonProjectRef> =>
  Effect.gen(function* () {
    const resolver = yield* Effect.serviceOption(RepositoryIdentityResolver);
    if (resolver._tag === "None") return folderProjectRef(cwd);
    const identity = yield* resolver.value
      .resolve(cwd)
      .pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (identity === null) return folderProjectRef(cwd);
    // The checkout's own folder name keeps its capitals ("VentureOS", not "ventureos").
    const folder = folderProjectRef(cwd).label;
    const name = identity.name ?? identity.displayName ?? folder;
    return {
      key: identity.canonicalKey,
      label: name.toLowerCase() === folder.toLowerCase() ? folder : name,
    };
  });
