# Hands loop on real apps: task results (issue #52)

Run 2026-11-03 by the `Baton hands loop` workflow (`.github/workflows/baton-hands-loop.yml`, run 41357657467) on a
`windows-2022` GitHub runner: a real Windows Server 2022 desktop (1024x768, one interactive session) with Notepad,
Calculator, File Explorer, Paint and Settings. The code under test is the code the assistant uses: the tool table
(`batonTools.ts`: `ui_tree`, `click_element`, `wait_for`, `type_text`, `press_keys`, `drag`, `screen_capture`), the
input driver (`inputDriver.ts`, a real `SendInput` and clipboard paste), the real UI Automation sidecar
(`native/baton-dictation`, built in the run) and the stop rule (`failureGuard.ts`). The harness is
`scripts/baton/hands-ci/`.

**What this does and does not measure.**

- **The planner is scripted.** A runner has no model login, so each task's see, act, check steps are written in
  `run.ts`. It measures the tool path: finding things by name, acting, waiting for a late window, reading back what
  happened, taking another route after an error, and stopping. It does not measure whether a model chooses well.
- **Not run:** the same tasks planned by a model (`claude` driving the tool server). There is no Linux equivalent (UI
  Automation is Windows); they need the laptop, or a runner with a model login. Listed as "model-planned run needs
  the laptop" for all 12.
- **Not run:** the gate (spoken yes for risky actions). Enter and Alt+F4 are asked about in the real assistant; the
  harness presses them directly. The gate has its own tests.
- A pass is judged from evidence outside the UI where it can be (the file's bytes, a registry value, a folder on disk,
  the clipboard) and from the tree or a pixel difference otherwise. Screenshots and the tree dump of each failure are
  in the run's artifact.

## Result: 12 of 12 passed

| Task                                                                               | Result | Steps | Seconds | Evidence or failure cause                                                         |
| ---------------------------------------------------------------------------------- | ------ | ----- | ------- | --------------------------------------------------------------------------------- |
| Type a sentence in Notepad and Save As to a named file, then read the file back    | pass   | 9     | 8       | fox.txt holds exactly the sentence (The quick brown fox jumps over the lazy dog.) |
| Open Help > About Notepad by name and confirm the dialog                           | pass   | 6     | 4.6     | the About Notepad dialog is the window with the keyboard                          |
| Turn on Word Wrap from the Format menu and verify the saved setting                | pass   | 8     | 6.5     | fWrap went from "" to "1"                                                         |
| Compute 12 x 34 in Calculator by clicking its buttons, and read the result         | pass   | 20    | 5.3     | the display reads: text: 408                                                      |
| Create a folder in File Explorer and rename it, then check the disk                | pass   | 13    | 10.3    | reports became reports-2026 on disk                                               |
| Draw a line in Paint and check, from screenshots, that the picture changed         | pass   | 4     | 6       | 152 sampled pixels changed after the stroke                                       |
| Click a menu that does not exist, then re-plan from the tree and open Edit         | pass   | 9     | 4.7     | the Edit menu opened (its items are listed)                                       |
| Refuse a third identical failing action, without clicking anything                 | pass   | 7     | 4.6     | outcomes: no control, no control, stopped, stopped                                |
| Close Notepad with unsaved text, wait for the save question, and answer Don't Save | pass   | 8     | 7.1     | Notepad exited after the answer                                                   |
| Type text, select all and copy in Notepad, and read the clipboard back             | pass   | 9     | 7.8     | the clipboard holds "alpha beta gamma"                                            |
| Read the window's controls and find the one with the keyboard                      | pass   | 4     | 4.5     | focused line: edit: Text Editor (focused)                                         |
| Open Settings > About and read the Windows edition name from the page              | pass   | 3     | 6.2     | read from the page: text: Windows Server 2022 Datacenter                          |

## Step logs

### notepad-save-as: pass

- act: launch notepad.exe (pid 6912)
- see: ui_tree {} -> Untitled - Notepad (166 ms)
- act: type_text {"text":"The quick brown fox jumps over the lazy dog.","why":"the sentence"} -> Typed. (976 ms)
- act: press_keys {"keys":["ctrl","s"],"why":"save"} -> Pressed. (1 ms)
- act: wait_for {"label":"File name","seconds":10} -> File name: is there. (1010 ms)
- check: ok: the Save As dialog showed up (waited for its File name box)
- act: type_text {"text":"C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\hands-1793572429509\\fox.txt","why":"the file name"} -> Typed. (787 ms)
- act: press_keys {"keys":["enter"],"why":"confirm"} -> Pressed. (2 ms)
- check: ok: fox.txt holds exactly the sentence (The quick brown fox jumps over the lazy dog.)

### menu-by-name: pass

- act: launch notepad.exe (pid 3044)
- see: ui_tree {} -> Untitled - Notepad (42 ms)
- act: click_element {"label":"Help","why":"open the menu"} -> Clicked Help. (52 ms)
- act: click_element {"label":"About Notepad","why":"the menu item"} -> Clicked About Notepad. (48 ms)
- see: ui_tree {} -> About Notepad (48 ms)
- check: ok: the About Notepad dialog is the window with the keyboard

### notepad-word-wrap: pass

- act: launch notepad.exe (pid 2472)
- see: ui_tree {} -> Untitled - Notepad (42 ms)
- act: click_element {"label":"Format","why":"open the menu"} -> Clicked Format. (52 ms)
- see: ui_tree {} -> Untitled - Notepad (42 ms)
- replan: looked at the menu: menu item: Word Wrap
- act: click_element {"label":"Word Wrap","why":"the setting"} -> Clicked Word Wrap. (52 ms)
- act: press_keys {"keys":["alt","f4"],"why":"close so it saves its settings"} -> Pressed. (1 ms)
- check: ok: fWrap went from "" to "1"

### calculator: pass

- act: launch calc.exe (pid 6856)
- see: ui_tree {} -> Calculator (76 ms)
- act: click_element {"label":"One","why":"a calculator button"} FAILED No control is named "One" in the window with the keyboard. Take a screenshot and click by position. (63 ms)
- replan: no control called "One"; trying the next name
- act: click_element {"label":"1","why":"a calculator button"} -> Clicked 1. (65 ms)
- act: click_element {"label":"Two","why":"a calculator button"} FAILED No control is named "Two" in the window with the keyboard. Take a screenshot and click by position. (61 ms)
- replan: no control called "Two"; trying the next name
- act: click_element {"label":"2","why":"a calculator button"} -> Clicked 2. (65 ms)
- act: click_element {"label":"Multiply by","why":"a calculator button"} FAILED No control is named "Multiply by" in the window with the keyboard. Take a screenshot and click by position. (61 ms)
- replan: no control called "Multiply by"; trying the next name
- act: click_element {"label":"Multiply","why":"a calculator button"} -> Clicked Multiply. (64 ms)
- act: click_element {"label":"Three","why":"a calculator button"} FAILED No control is named "Three" in the window with the keyboard. Take a screenshot and click by position. (63 ms)
- replan: no control called "Three"; trying the next name
- act: click_element {"label":"3","why":"a calculator button"} -> Clicked 3. (61 ms)
- act: click_element {"label":"Four","why":"a calculator button"} FAILED No control is named "Four" in the window with the keyboard. Take a screenshot and click by position. (58 ms)
- replan: no control called "Four"; trying the next name
- act: click_element {"label":"4","why":"a calculator button"} -> Clicked 4. (66 ms)
- act: click_element {"label":"Equals","why":"a calculator button"} -> Clicked Equals. (63 ms)
- see: ui_tree {} -> Calculator (73 ms)
- check: ok: the display reads: text: 408

### explorer-folder: pass

- act: launch explorer.exe (pid 6124)
- see: ui_tree {} -> explore (146 ms)
- see: ui_tree {} -> explore (130 ms)
- replan: read the tree; it has button: New folder
- act: click_element {"label":"New folder","why":"make the folder"} -> Clicked New folder. (99 ms)
- act: type_text {"text":"reports","why":"the folder name"} -> Typed. (798 ms)
- act: press_keys {"keys":["enter"],"why":"name it"} -> Pressed.
- check: ok: the folder reports exists on disk
- act: click_element {"label":"reports","why":"select the folder to rename"} -> Clicked reports. (110 ms)
- act: press_keys {"keys":["f2"],"why":"rename the selected folder"} -> Pressed.
- act: type_text {"text":"reports-2026","why":"the new name"} -> Typed. (782 ms)
- act: press_keys {"keys":["enter"],"why":"rename"} -> Pressed. (1 ms)
- check: ok: reports became reports-2026 on disk

### paint-draw: pass

- act: launch mspaint.exe (pid 7384)
- see: ui_tree {} -> Untitled - Paint (112 ms)
- act: drag {"x":400,"y":380,"to_x":620,"to_y":460,"why":"draw a line"} -> Dragged. (165 ms)
- check: ok: 152 sampled pixels changed after the stroke

### replan-after-wrong-name: pass

- act: launch notepad.exe (pid 7088)
- see: ui_tree {} -> Untitled - Notepad (42 ms)
- act: click_element {"label":"Modify","why":"guess at the menu"} FAILED No control is named "Modify" in the window with the keyboard. Take a screenshot and click by position. (36 ms)
- check: ok: the wrong name was refused rather than clicked
- see: ui_tree {} -> Untitled - Notepad (36 ms)
- replan: read the tree; the menu is called menu item: Edit
- act: click_element {"label":"Edit","why":"the real menu"} -> Clicked Edit. (42 ms)
- see: ui_tree {} -> Untitled - Notepad (47 ms)
- check: ok: the Edit menu opened (its items are listed)

### stop-after-two-failures: pass

- act: launch notepad.exe (pid 8088)
- see: ui_tree {} -> Untitled - Notepad (42 ms)
- act: click_element {"label":"Frobnicate","why":"a control that is not there"} FAILED No control is named "Frobnicate" in the window with the keyboard. Take a screenshot and click by position. (35 ms)
- act: click_element {"label":"Frobnicate","why":"a control that is not there"} FAILED No control is named "Frobnicate" in the window with the keyboard. Take a screenshot and click by position. (33 ms)
- act: click_element {"label":"Frobnicate","why":"a control that is not there"} FAILED Stopped: click_element has failed 2 times in a row with these same arguments. Do not try it again. Tell him what blocked (1 ms)
- act: click_element {"label":"Frobnicate","why":"a control that is not there"} FAILED Stopped: click_element has failed 2 times in a row with these same arguments. Do not try it again. Tell him what blocked
- check: ok: outcomes: no control, no control, stopped, stopped

### late-dialog: pass

- act: launch notepad.exe (pid 3668)
- see: ui_tree {} -> Untitled - Notepad (40 ms)
- act: type_text {"text":"unsaved words","why":"something to lose"} -> Typed. (774 ms)
- act: press_keys {"keys":["alt","f4"],"why":"close it"} -> Pressed. (1 ms)
- act: wait_for {"label":"Don't Save","seconds":10} -> Don't Save is there. (84 ms)
- check: ok: the save question appeared and was found by its button's name
- act: click_element {"label":"Don't Save","why":"discard"} -> Clicked Don't Save. (72 ms)
- check: ok: Notepad exited after the answer

### clipboard-readback: pass

- act: launch notepad.exe (pid 2868)
- see: ui_tree {} -> Untitled - Notepad (41 ms)
- act: type_text {"text":"alpha beta gamma","why":"the text"} -> Typed. (757 ms)
- act: press_keys {"keys":["ctrl","a"],"why":"select all"} -> Pressed.
- act: press_keys {"keys":["ctrl","c"],"why":"copy"} -> Pressed. (1 ms)
- replan: the clipboard reads "" after Ctrl+C; copying from the Edit menu instead
- act: click_element {"label":"Edit","why":"open the menu"} -> Clicked Edit. (49 ms)
- act: click_element {"label":"Copy","why":"copy the selection"} -> Clicked Copy Ctrl+C. (47 ms)
- check: ok: the clipboard holds "alpha beta gamma"

### tree-shows-focus: pass

- act: launch notepad.exe (pid 2904)
- see: ui_tree {} -> Untitled - Notepad (41 ms)
- see: ui_tree {} -> Untitled - Notepad (44 ms)
- check: ok: focused line: edit: Text Editor (focused)

### settings-read: pass

- act: start ms-settings:about
- see: ui_tree {} -> Settings (233 ms)
- check: ok: read from the page: text: Windows Server 2022 Datacenter

## Ask text for the laptop (model-planned runs)

The same twelve tasks as things to say or type to the assistant, word for word, with what to check afterwards. Say
them with "One assistant" and "Use my Chrome" as they are. Each leaves an `agent_turn_start` line, `action` lines
for every tool call (with the gate's decision) and an `agent_turn` line in `voice-turns.ndjson`, with `tools` and
`decisions`; read those with the result. A turn that fails or hangs still leaves its `agent_turn` line with
`ok: false`. Some asks will be asked about aloud (Enter, closing a window): answer yes.

| #   | Say or type                                                                                                             | Pass if                                                                        | Check                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1   | "Open Notepad, type The quick brown fox jumps over the lazy dog. and save it as fox.txt in my Documents folder."        | the file holds exactly the sentence                                            | open `Documents\fox.txt`                                                              |
| 2   | "In Notepad, open the Help menu, choose About Notepad, and tell me what the box says."                                  | it names the About box and reads it out                                        | the box was open                                                                      |
| 3   | "In Notepad, turn on Word Wrap from the Format menu, then close Notepad."                                               | Word Wrap is on the next time Notepad opens                                    | open Notepad, look at Format                                                          |
| 4   | "Open Calculator and work out 12 times 34 by clicking its buttons, then tell me the answer."                            | it says 408                                                                    | the display read 408                                                                  |
| 5   | "Open File Explorer in my Documents folder, make a new folder called reports, then rename it to reports-2026."          | `reports-2026` exists and `reports` does not                                   | look in Documents                                                                     |
| 6   | "Open Paint and draw a line across the canvas."                                                                         | a line is on the canvas                                                        | look at Paint                                                                         |
| 7   | "In Notepad, open the menu for changing the text. I think it is called Modify."                                         | it finds that there is no Modify, reads the menu names, and opens Edit         | Edit's items are showing                                                              |
| 8   | "In Notepad, click the control called Frobnicate."                                                                      | it tries at most twice, then tells me it is not there and does not keep trying | the `tools` list has at most two `click_element` for it, and a "Stopped" in the third |
| 9   | "Open Notepad, type unsaved words, then close it and do not save."                                                      | Notepad is gone, nothing saved                                                 | no Notepad window, no new file                                                        |
| 10  | "Open Notepad, type alpha beta gamma, select all, copy it, then paste it on a new line and tell me what the line says." | the second line reads alpha beta gamma                                         | the text appears twice                                                                |
| 11  | "Open Notepad and tell me which control has the keyboard."                                                              | it says the text area (the Text Editor)                                        | Notepad's text area                                                                   |
| 12  | "Open Settings, go to About, and tell me which edition of Windows this is."                                             | it reads out the edition on that page                                          | the page it read                                                                      |

Ask 7 and 8 test behaviour rather than an outcome: 7 should show a `ui_tree` before the second click; 8 should end with
the assistant saying it stopped, not with a click. Ask 10 checks the copy by reading it back, since a copy shortcut
once returned "Pressed" and copied nothing. Close what each ask leaves open before the next.

## What the runs found, and what was fixed

The set did not pass first time. Eight runs to get here, each a real fix:

1. **The harness itself** (not the tools): TypeScript parameter properties are not valid under Node's type
   stripping; an empty clipboard could not be written back (`Set-Clipboard` refuses null), which killed the run.
   Fixed in the harness; the empty-clipboard case matters to the product too, where Electron's clipboard handles it.
2. **A launcher that leaves a window behind.** Calculator opened from `calc.exe` kept the keyboard after its task
   and every later task read Calculator's tree (six failures with one cause). The harness now closes what each task
   opened and brings each app forward by title.
3. **File Explorer: the keyboard shortcut for New folder did nothing** because a fresh window has no focused file
   list. Re-planned from the tree, which names a `New folder` button: `click_element` found it and the task passed.
   This is the loop working as designed (read the tree, take the route it names).
4. **A copy shortcut that did not copy: found, and a product bug.** `press_keys ["ctrl","c"]` returned "Pressed" but the
   clipboard was unchanged. A diagnostic run polled the clipboard after each way of copying: Ctrl+C worked after a 2.5
   s pause and failed straight after `type_text`. Typing goes by the clipboard, and 400 ms after a paste Tessaya put
   his old clipboard back; a copy made inside that window was overwritten by the restore. The restore now happens only
   if the clipboard still holds what was pasted (`createPaster`, with a test that fails on the old code). The harness
   keeps its read-back and its menu fallback, so a regression shows as a re-plan in the step log.
5. **The stop rule was only in the prompt.** Task 8 needed the third identical failing action to be refused; that
   was a model's good behaviour, not code. `failureGuard.ts` now enforces it in the tool server (two failures in a
   row with the same arguments, the third call is refused without running), with a unit test, and the task checks
   the outcomes `no control, no control, stopped, stopped`.

## Not covered by this set

Dialogs that need a mouse drag to resolve, apps that expose no names to UI Automation (the screenshot check covers
Paint only as "something changed"), Windows with a different language (the labels are English), and High DPI scaling
(the runner is 100%). The model-planned variants and the laptop's own apps are the next measure, per the comparison
note in `hands-comparison-2026-11-03.md`.
