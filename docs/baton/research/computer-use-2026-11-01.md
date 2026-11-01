# Open-source computer use, snapshot of 2026-11-01

For Baton issue #52 and D127. Licence, activity and stated features come from each project's GitHub record and README
on this date. **Their code was not read, and nothing here was run.** Every score below is the project's own claim.

| Project                   | Licence    | Last push  | Stars  | What it claims                                                                                     |
| ------------------------- | ---------- | ---------- | ------ | -------------------------------------------------------------------------------------------------- |
| microsoft/UFO             | MIT        | 2026-10-30 | 10,147 | Windows UIA, Win32 and COM control; hybrid GUI plus API actions; visual plus UIA control detection |
| simular-ai/Agent-S        | Apache-2.0 | 2026-10-30 | 12,841 | Agent S3 at 72.60% on OSWorld; Agent S4 (2026-10-20) evolves its tool interfaces from experience   |
| bytedance/UI-TARS-desktop | Apache-2.0 | 2026-10-09 | 39,491 | Browser agent mixing visual grounding and DOM; SDK for GUI agents                                  |
| trycua/cua                | MIT        | 2026-11-01 | 31,434 | Drivers, cross-OS sandboxes and benchmarks                                                         |
| microsoft/magentic-ui     | MIT        | 2026-09-23 | 10,109 | Agent across the browser and local files                                                           |
| xlang-ai/OSWorld          | Apache-2.0 | 2026-10-26 | 3,246  | The benchmark most of the above report against                                                     |

## What Baton takes

**Hybrid actions, from UFO.** Use an API where one exists and the GUI only where it does not. Baton's form is the
operator (D127): files and shell go through the harness's own tools, and the router prefers `operate` to `drive`
whenever no click is needed.

Baton already has a form of two others: the accessibility tree over the model's pixels (`locate`, D111), and a check
after each drive step (`verify`).

## What is not ported yet, and why

#52 says to port only where a before and after on a fixed task set shows a gain. That run needs a Windows desktop, and
the laptop is off limits while he is at it, so no pixel-level logic has been ported. The set to run:

1. Open Notepad, type a line, save it to Documents under a given name.
2. Open a named folder in Explorer and sort it by date.
3. Change one Settings page value and change it back.
4. In a browser, find a page and copy its heading into Notepad.
5. In a spreadsheet, enter three numbers and a sum.
6. Close a dialog that appears unasked, then carry on with task 1.

Score each by whether it finished, steps taken, wall time, and misclicks by the verifier's count, three runs each. The
first to try after that: visual plus UIA detection for controls the tree does not name.
