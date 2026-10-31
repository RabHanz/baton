/**
 * Esc is one global key with several owners: a drive, a recording, a card on screen. Registering it
 * twice fails and unregistering drops everyone, so they share this list. One press goes to the most
 * urgent holder, so closing a card cannot lose a recording; the next press reaches the next. It is
 * his key again the moment the list is empty.
 */
export type EscapeRank = "drive" | "recording" | "card";
const URGENCY: Readonly<Record<EscapeRank, number>> = { drive: 2, recording: 1, card: 0 };

export const createEscapeKey = (shortcut: {
  readonly register: (accelerator: string, callback: () => void) => unknown;
  readonly unregister: (accelerator: string) => void;
}) => {
  const holders: Array<{ readonly press: () => void; readonly urgency: number }> = [];
  const pressed = () => {
    // Newest first among equals. One that throws must not cost him the stop behind it.
    const order = holders
      .map((holder, at) => ({ holder, at }))
      .sort((a, b) => b.holder.urgency - a.holder.urgency || b.at - a.at);
    for (const { holder } of order) {
      try {
        return holder.press();
      } catch {
        continue;
      }
    }
  };
  return (onPress: () => void, rank: EscapeRank = "card"): (() => void) => {
    const holder = { press: () => onPress(), urgency: URGENCY[rank] };
    if (holders.length === 0) shortcut.register("Escape", pressed);
    holders.push(holder);
    return () => {
      const at = holders.indexOf(holder);
      if (at < 0) return;
      holders.splice(at, 1);
      if (holders.length === 0) shortcut.unregister("Escape");
    };
  };
};
