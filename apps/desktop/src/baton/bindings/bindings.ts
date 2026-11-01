/**
 * Keyboard and mouse bindings (D141). One row per action; an unset row uses the action's default,
 * a row set to null is switched off on purpose. Saved in the voice settings file as
 * `bindings: [{ action, input }]`. Pure: capture, conflicts and the accelerator forms are testable.
 */
export type MouseButton = "middle" | "back" | "forward" | "left+right";

export type BindingInput =
  | { readonly type: "key"; readonly accelerator: string }
  | { readonly type: "mouse"; readonly button: MouseButton };

export interface Binding {
  readonly action: string;
  /** null: he switched it off. */
  readonly input: BindingInput | null;
}

export interface ActionDef {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** What it does when nothing is set. */
  readonly fallback: BindingInput | null;
}

const key = (accelerator: string): BindingInput => ({ type: "key", accelerator });

/** Ctrl, Alt, Shift, then Meta, then the key: one spelling for every comparison and every file. */
const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const ALIASES: Readonly<Record<string, string>> = {
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Meta",
  win: "Meta",
  windows: "Meta",
  super: "Meta",
  cmd: "Meta",
  command: "Meta",
  commandorcontrol: "Ctrl",
  cmdorctrl: "Ctrl",
};

export const normaliseAccelerator = (accelerator: string): string => {
  const parts = accelerator
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const mods = new Set<string>();
  let main = "";
  for (const part of parts) {
    const alias = ALIASES[part.toLowerCase()];
    if (alias !== undefined) mods.add(alias);
    else main = part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1);
  }
  return [...MODIFIERS.filter((m) => mods.has(m)), ...(main === "" ? [] : [main])].join("+");
};

/** Electron's global shortcut wants "Control", not "Ctrl". */
export const toElectronAccelerator = (accelerator: string): string =>
  normaliseAccelerator(accelerator).replace(/^Ctrl\b|\+Ctrl\b/g, (m) =>
    m.replace("Ctrl", "Control"),
  );

export const sameInput = (a: BindingInput | null, b: BindingInput | null): boolean =>
  a === null || b === null
    ? false
    : a.type === "key" && b.type === "key"
      ? normaliseAccelerator(a.accelerator) === normaliseAccelerator(b.accelerator)
      : a.type === "mouse" && b.type === "mouse" && a.button === b.button;

export const ACTIONS: ReadonlyArray<ActionDef> = [
  {
    id: "wake",
    label: "Start listening",
    hint: "Wake Baton without saying the wake word.",
    fallback: key("Ctrl+Alt+Shift+F5"),
  },
  { id: "stop", label: "Stop", hint: "End an answer, a lesson or a drive.", fallback: null },
  {
    id: "mute",
    label: "Mute",
    hint: "Turn the microphone off and on.",
    fallback: key("Ctrl+Alt+Shift+F7"),
  },
  {
    id: "direct",
    label: "Send words to the focused session",
    hint: "What you say goes to the session in focus.",
    fallback: key("Ctrl+Alt+Shift+F6"),
  },
  {
    id: "hold",
    label: "Hold to dictate",
    hint: "Dictate while the key is down.",
    fallback: key("Ctrl+Alt+Space"),
  },
  {
    id: "toggle",
    label: "Start and stop dictating",
    hint: "Press once to start, again to stop.",
    fallback: key("Ctrl+Alt+Shift+Space"),
  },
  {
    id: "dictation",
    label: "Dictation on or off",
    hint: "Turn Baton's dictation key on or off.",
    fallback: key("Ctrl+Alt+Shift+F8"),
  },
  {
    id: "ask",
    label: "Ask Baton",
    hint: "Open the box to type a question.",
    fallback: key("Ctrl+Alt+Shift+B"),
  },
  {
    id: "clear",
    label: "Clear the screen",
    hint: "Remove the pointer and any card.",
    fallback: null,
  },
];

const isButton = (v: unknown): v is MouseButton =>
  v === "middle" || v === "back" || v === "forward" || v === "left+right";

/** The saved list is untrusted: only a known action with a well-formed input survives. */
export const parseBindings = (raw: unknown): ReadonlyArray<Binding> => {
  if (!Array.isArray(raw)) return [];
  const known = new Set(ACTIONS.map((a) => a.id));
  const out = new Map<string, Binding>();
  for (const item of raw) {
    const { action, input } = (item ?? {}) as { action?: unknown; input?: unknown };
    if (typeof action !== "string" || !known.has(action)) continue;
    if (input === null) out.set(action, { action, input: null });
    else if (typeof input === "object" && input !== undefined) {
      const i = input as { type?: unknown; accelerator?: unknown; button?: unknown };
      if (
        i.type === "key" &&
        typeof i.accelerator === "string" &&
        normaliseAccelerator(i.accelerator) !== ""
      ) {
        out.set(action, {
          action,
          input: { type: "key", accelerator: normaliseAccelerator(i.accelerator) },
        });
      } else if (i.type === "mouse" && isButton(i.button)) {
        out.set(action, { action, input: { type: "mouse", button: i.button } });
      }
    }
  }
  return [...out.values()];
};

export interface Effective {
  readonly def: ActionDef;
  readonly input: BindingInput | null;
  readonly isDefault: boolean;
  /** The other actions that use the same input. */
  readonly conflictsWith: ReadonlyArray<string>;
}

export const effective = (
  saved: ReadonlyArray<Binding>,
  /** The dictation keys live in their own settings and win over the table's fallback. */
  fallbacks: Readonly<Record<string, BindingInput | null>> = {},
): ReadonlyArray<Effective> => {
  const rows = ACTIONS.map((def) => {
    const own = saved.find((b) => b.action === def.id);
    const fallback = def.id in fallbacks ? (fallbacks[def.id] ?? null) : def.fallback;
    return { def, input: own === undefined ? fallback : own.input, isDefault: own === undefined };
  });
  return rows.map((row) => ({
    ...row,
    conflictsWith: rows
      .filter((o) => o.def.id !== row.def.id && sameInput(o.input, row.input))
      .map((o) => o.def.label),
  }));
};

/** A new input for one action, or the saved list with that action put back to its default. */
export const withBinding = (
  saved: ReadonlyArray<Binding>,
  action: string,
  input: BindingInput | null | "reset",
): ReadonlyArray<Binding> => {
  const rest = saved.filter((b) => b.action !== action);
  if (input === "reset") return rest;
  return [...rest, { action, input: input === null ? null : input }];
};
