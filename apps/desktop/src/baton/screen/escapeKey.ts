/**
 * Esc is one global key with several owners: the pill, a card on screen, a drive, a recording.
 * Registering it twice fails and unregistering drops everyone, so they share this list. A press
 * reaches every holder: a recording started during a drive must not take the only Esc that stops
 * the drive. It is his key again the moment the list is empty.
 */
export const createEscapeKey = (shortcut: {
  readonly register: (accelerator: string, callback: () => void) => unknown;
  readonly unregister: (accelerator: string) => void;
}) => {
  const holders: Array<() => void> = [];
  return (onPress: () => void): (() => void) => {
    const holder = () => onPress();
    if (holders.length === 0) {
      shortcut.register("Escape", () => [...holders].forEach((press) => press()));
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
