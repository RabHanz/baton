# Screen companion, real run on Linux (2026-10-27)

`scripts/baton/screen-smoke.sh` under Xvfb (1600×1000, xcompmgr for transparency), the desktop's
own screen modules, his `claude` on the subscription answering, xdotool playing the user. Frames
are the full screen at 1280 px with the overlay in them. The harness answered every approval box
"yes"; the drive run's box texts are in `dialogs.txt`.

| Frame                                 | Mode  | What is on screen                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-look-points-at-name-field.jpg`    | look  | Question "where do I type my name on this form?". The blue pointer sits in the "Your name" field, labelled **name field**.                                                                                                                                                               |
| `02-teach-step-1.jpg`                 | teach | Card **Step 1**: "Start by clicking the "Your name" box, so the form knows where your typing should go. Then you'll type Rabee in it." Hint: "Do it and I'll notice, or say "next". "Stop" ends the lesson." Pointer on the name field.                                                  |
| `03-teach-step-2-after-noticing.jpg`  | teach | After xdotool typed "Rabee", with no "next" said: card **Step 2**: "Rabee is in the name field, so that step worked. Next, click the Email box and type your own email address, since the form needs a way to reach you on the waiting list." Pointer moved to **email field**.          |
| `04-teach-after-submit.jpg`           | teach | After the user clicked Submit: the page reads "Submitted: Rabee"; the lesson ended on `[DONE]` and the overlay has cleared.                                                                                                                                                              |
| `05-drive-plan-awaiting-approval.jpg` | drive | Numbered dots **1** on the name field and **3** on Submit. Card "Fill in name and submit the waiting list form": "1. Click: Focus the name field 2. Type "Baton Test": Enter the name 3. Click: Click Submit", then "Waiting for your approval." (the card now keeps one step per line). |
| `06-drive-finished.jpg`               | drive | After "Run it": the name field holds "Baton Test" and the page reads "Submitted: Baton Test".                                                                                                                                                                                            |

Timings: look answered and pointed 14 s after the question, including Claude's start-up; each
teach step 4–8 s after the screen settled; drive planned in 4 s and ran three steps with two
screen checks in 36 s.

The pointer and label look paler in frame 01 than in the others; that frame caught the compositor
mid-blend under Xvfb. On Windows the overlay is excluded from captures by content protection, so
it cannot be seen in Baton's own screenshots at all.
