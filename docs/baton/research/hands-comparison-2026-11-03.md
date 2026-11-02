# Hands loop against UFO, Agent S and UI-TARS Desktop (public docs only, 2026-11-03)

Answers issue #52's ask to compare Tessaya's drive with open projects. Source: each project's public repository page, read on this date. **No code was run and no source was read beyond the front pages**, so this is a comparison of stated design, not of behaviour. Every score below is the project's own claim; none was independently checked, and the pages themselves note nothing about verification. Per #52, nothing is ported without a before-and-after on a fixed task set (`scripts/baton/computer-use-harness.sh`), which needs his laptop and him away.

|                | UFO (Microsoft)                                                                                                    | Agent S (Simular)                                                                                               | UI-TARS Desktop (ByteDance)                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Licence        | MIT                                                                                                                | Apache-2.0                                                                                                      | Apache-2.0                                        |
| Windows-first  | Yes                                                                                                                | General, cross-platform                                                                                         | General                                           |
| Perception     | Windows UI Automation, Win32 and COM, combined with visual detection                                               | Screenshot-based (the page names no accessibility tree)                                                         | Screenshot and a vision-language model            |
| Structure      | A host agent coordinates per-application agents; a newer layer coordinates devices                                 | "Compositional generalist-specialist" (page gives no detail)                                                    | A single model-driven loop (page gives no detail) |
| Speed ideas    | Direct API calls beside GUI actions; "speculative" batches of predicted actions, claimed to cut model calls by 51% | Memory from past tasks; later versions "evolve the interfaces" the agents use                                   | Not stated                                        |
| Scores claimed | Names WindowsAgentArena and OSWorld, gives no score on the page                                                    | OSWorld 72.6% (S3), WindowsAgentArena "state of the art" with no number; newer harder benchmark scores near 21% | None on the page                                  |

## What Tessaya already does the same way

- **API or UI Automation first, pixels last** (UFO's central idea): `ui_tree`, `click_element` and `wait_for` (D144) read and click named controls and use a screenshot only for what the tree cannot name.
- **A loop that looks again and re-plans**: the assistant's prompt makes it re-read after each action and change plan, with a two-failure stop. This is one agent with every tool, not a fixed plan from one screenshot.
- **The gate on every call**, spoken yes for anything high-risk, and the mouse guard. None of the three projects' pages describe an equivalent; this is Tessaya's difference and stays.

## What is worth testing, in order

1. **Hybrid detection when the tree is empty** (UFO). Many apps (games, canvas apps, some Electron builds) expose no names. Today the assistant falls back to a screenshot and its own pointing. A detector that proposes boxes would help only where the tree is empty, so measure on exactly those apps first.
2. **Batching predicted actions** (UFO's "speculative" idea). It saves model calls on predictable sequences (open menu, pick item). Risk: a batch skips the look-again step the gate and the loop rely on. Test only for sequences inside one window, with a check between batches rather than none.
3. **Memory of what worked in an app** (Agent S). Fits Tessaya's notes and the shared learnings in D146, kept as plain files he can read. Test: the same app task on the second run against the first.
4. **A grounding model for clicks** (UI-TARS, Agent S). Not recommended now: it needs a second model to run or call, against the rule of using his subscription and no extra service. Revisit only if (1) shows a gap that the subscription model's own pointing cannot close.

## Measuring

Use the six-task Windows set already in the harness, three runs each, and report success, steps, misclicks and model calls. A change counts only if success rises without more misclicks. Do not use a published score as a target: the numbers above are vendor-reported, measured on benchmarks Tessaya does not run.

## Not done

No run, no source reading, no benchmark. This note should be replaced by measured results once the laptop run exists.
