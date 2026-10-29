# D88 proof frames, 2026-10-29 (signzart, `0.1.2-baton.41`)

T3's own web client at 390 px, paired for the run. The test session is `fab-baton-prompt-test`
(Claude Code in Herdr, manual permission mode, with a project hook that makes every Bash call ask).
Each prompt was raised by a message typed into the terminal, not from T3, so the thread had no open
turn when it appeared.

| Frame                             | What is on screen                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colour-390-question.png`         | the first relayed AskUserQuestion: header "Colour", the question, Red/Green/Blue with their descriptions as buttons, and the free-text field for "Type something" |
| `permission-390-1-question.png`   | a permission dialog: what is asked about (Bash command · echo PERM-OK-7 · the hook's reason), "Do you want to proceed?", Yes / No                                 |
| `permission-390-3-answered.png`   | after tapping Yes: "Answered in the terminal: Yes. The session is busy now." The command ran and replied PERM-OK-7                                                |
| `ask-390-1-question.png`          | a second AskUserQuestion (Fruit: Apple / Mango / Kiwi) while the thread shows T3's working bar                                                                    |
| `ask-390-4-wait-Mango-PICKED.png` | after tapping Mango: the answered question row ("Which fruit do you want? Mango") and Claude's reply "Mango-PICKED"                                               |
| `pane-permission.txt`             | the terminal screen of the permission dialog, as read through Herdr                                                                                               |
| `pane-after.txt`                  | the terminal afterwards: each answer recorded by Claude Code ("→ Green", "→ Mango", "→ Large") and the session idle                                               |

Also checked: a question answered in the terminal instead (Size, "Large") is marked expired in T3
and closed in the thread, so no stale buttons stay behind. Every request created during the run:
Green, Yes and Mango resolved from T3, Large expired.
