# The daily-driver pass, on the live signzart server

Taken against `0.0.43-fabric.8` through a paired browser, at 1280×860 and at a
phone's 390×844. Nothing in this walk ran a sentence or sent a message.

| Frame                           | What is on screen                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-before-no-import-entry.png` | Settings → Connections as a paired browser saw it **before** this work: "Administrative access", an empty Environments list, and no way to reach the conversations on the machine you are connected to. This frame is why the import action became a row as well as a row-menu item.                 |
| `01-landing-fleet.png`          | The first screen after signing in. "Work", the sentence input, the machine (`signzart-prod`), the fleet — empty here — and **Pick up where you left off**, holding the 420 MB conversation imported from `735f333a…`. Upstream's index route would have dropped straight into an empty draft thread. |
| `02-landing-phone.png`          | The same first screen at 390 px. The sidebar is a button; the sentence input and the conversation are still the screen. The update toast on top is upstream's own notification, dismissible, not layout.                                                                                             |
| `03-import-entry.png`           | Settings → Connections now: **Conversations · Find conversations**, in the same section as the machine it reads.                                                                                                                                                                                     |

## What the frames do not show

- **No work sessions exist on this machine**, so the fleet list itself is empty
  and the "Needs me" filter has nothing to count. The empty state is what a
  person with history actually lands on, which is why it names the action that
  fills it rather than saying "nothing here".
- The **account line in the model picker** needs a thread open and a driver with
  more than one login; it is unit-tested rather than framed.
