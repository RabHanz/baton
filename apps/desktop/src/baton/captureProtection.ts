/**
 * Overlay windows (pointer, cards, pill, toasts) are kept out of every screen capture so they never appear in
 * what Tessaya shows the model or in a recording of a person's screen. A test run (BATON_TEST_DIR set) records
 * itself on purpose, and needs to see them; a normal run is always protected.
 */
export const overlaysVisibleToCapture = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean => (env["BATON_TEST_DIR"] ?? "") !== "";

export const protectFromCapture = (win: { setContentProtection: (on: boolean) => void }): void =>
  win.setContentProtection(!overlaysVisibleToCapture());
