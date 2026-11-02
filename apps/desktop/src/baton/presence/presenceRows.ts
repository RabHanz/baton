/** The Presence group of the settings (D149): clear switches, none behind "More options". */
import type { HomeControl } from "../home/batonHome.ts";

export interface PresenceSettings {
  readonly awarenessWindow: boolean;
  readonly awarenessIdle: boolean;
  readonly awarenessFocus: boolean;
  readonly awarenessJobs: boolean;
  readonly initiativeMode: "off" | "written" | "spoken";
  readonly initiativePerHour: number;
}

const AWARE = "Presence: what I may know right now";
const SPEAK = "Presence: speaking up";
const WATCH = "Presence: what I watch";

export const PER_HOUR = [1, 3, 5, 10] as const;

export const presenceControls = (s: PresenceSettings): ReadonlyArray<HomeControl> => [
  {
    id: "pr.awWindow",
    section: AWARE,
    label: "Know which app and window you are in",
    hint: "Off until you turn it on. Windows of password managers, banking and private browsing are replaced with 'a private window'. Only the last 30 minutes are held, in memory, never saved. Never what you type or copy.",
    kind: "toggle",
    on: s.awarenessWindow,
  },
  {
    id: "pr.awIdle",
    section: AWARE,
    label: "Know when you are away from the keyboard",
    hint: "Only how long it has been since you last used the keyboard or mouse.",
    kind: "toggle",
    on: s.awarenessIdle,
  },
  {
    id: "pr.awFocus",
    section: AWARE,
    label: "Know which session you have focused",
    kind: "toggle",
    on: s.awarenessFocus,
  },
  {
    id: "pr.awJobs",
    section: AWARE,
    label: "Know which jobs are running",
    kind: "toggle",
    on: s.awarenessJobs,
  },
  {
    id: "pr.initiative",
    section: SPEAK,
    label: "Offer to look when something needs a look",
    hint: "A failed or silent session, a failed build on a repository you list, a commitment that is due. It asks first: Yes, Later or Never. It never acts on its own. Uses your quiet hours.",
    kind: "choice",
    value: s.initiativeMode,
    options: [
      { value: "off", label: "Off" },
      { value: "written", label: "A card" },
      { value: "spoken", label: "A card and one spoken line" },
    ],
  },
  {
    id: "pr.perHour",
    section: SPEAK,
    label: "At most this many offers an hour",
    kind: "choice",
    value: String(s.initiativePerHour),
    options: PER_HOUR.map((n) => ({ value: String(n), label: String(n) })),
  },
  {
    id: "pr.watch",
    section: WATCH,
    label: "Repositories and deadlines to read",
    hint: "Read-only. Set needsRepos (issue labels), ciRepos (failed builds) and needsDeadlinesFile in the settings file; the window cannot take typed lists yet.",
    kind: "action",
    button: "Open settings file",
  },
];

/** The settings patch a Presence control means, or null for an id or value that is not one. */
export const presencePatch = (
  id: string,
  value: string | boolean | null,
): Partial<PresenceSettings> | null => {
  const on = value === true;
  switch (id) {
    case "pr.awWindow":
      return { awarenessWindow: on };
    case "pr.awIdle":
      return { awarenessIdle: on };
    case "pr.awFocus":
      return { awarenessFocus: on };
    case "pr.awJobs":
      return { awarenessJobs: on };
    case "pr.initiative":
      return value === "off" || value === "written" || value === "spoken"
        ? { initiativeMode: value }
        : null;
    case "pr.perHour": {
      const n = Number(value);
      return (PER_HOUR as ReadonlyArray<number>).includes(n) ? { initiativePerHour: n } : null;
    }
    default:
      return null;
  }
};
