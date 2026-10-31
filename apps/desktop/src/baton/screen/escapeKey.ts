/**
 * Esc is one global key with several owners: the pill, a card on screen, a drive, a recording.
 * Registering it twice fails and unregistering drops everyone, so they share this stack and the
 * newest holder gets the press. It is his key again the moment the stack is empty.
 */
export const createEscapeKey = (shortcut: {
  readonly register: (accelerator: string, callback: () => void) => unknown;
  readonly unregister: (accelerator: string) => void;
}) => {
  const holders: Array<() => void> = [];
  return (onPress: () => void): (() => void) => {
    const holder = () => onPress();
    if (holders.length === 0) {
      shortcut.register("Escape", () => holders.at(-1)?.());
    }
    holders.push(holder);
    return () => {
      const at = holders.indexOf(holder);
      if (at < 0) return;
      holders.splice(at, 1);
      if (holders.length === 0) shortcut.unregister("Escape");
    };
  };
};
