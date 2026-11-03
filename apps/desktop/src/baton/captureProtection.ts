// @effect-diagnostics globalTimers:off
/**
 * Overlay windows (pointer, cards, pill, toasts) can be kept out of every screen capture with content
 * protection. That also hides them from the person's own screenshot tool and from screen sharing, so it is a
 * setting and is OFF by default. When it is off, Tessaya's own grab hides the windows for the instant it takes.
 * A test run (BATON_TEST_DIR set) records itself on purpose and never protects.
 */
export const overlaysVisibleToCapture = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean => (env["BATON_TEST_DIR"] ?? "") !== "";

interface Protectable {
  readonly setContentProtection: (on: boolean) => void;
  readonly isDestroyed?: () => boolean;
  readonly isVisible?: () => boolean;
  readonly hide?: () => void;
  readonly showInactive?: () => void;
}

const windows = new Set<Protectable>();
let hideFromCapture = false;

const wanted = (): boolean => hideFromCapture && !overlaysVisibleToCapture();

/** True when content protection is doing the hiding, so a grab need not hide the windows itself. */
export const protectionOn = (): boolean => wanted();

/** Registers a Tessaya window; it follows the setting now and whenever it changes. */
export const protectFromCapture = (win: Protectable): void => {
  windows.add(win);
  win.setContentProtection(wanted());
};

/** The "Hide Tessaya from screenshots and screen sharing" setting, applied live to every window. */
export const setHideFromCapture = (on: boolean): void => {
  hideFromCapture = on;
  for (const win of windows) {
    if (win.isDestroyed?.() === true) windows.delete(win);
    else win.setContentProtection(wanted());
  }
};

/** Runs `fn` (a screen grab) with every visible Tessaya window out of the picture. */
export const hiddenForCapture = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (wanted()) return fn();
  const shown = [...windows].filter((w) => w.isDestroyed?.() !== true && w.isVisible?.() === true);
  for (const w of shown) w.hide?.();
  try {
    if (shown.length > 0) await new Promise((r) => setTimeout(r, 120));
    return await fn();
  } finally {
    for (const w of shown) if (w.isDestroyed?.() !== true) w.showInactive?.();
  }
};
