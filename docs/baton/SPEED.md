# The window's speed

Measured 2026-11-03 on a Linux box with the page script run in Node against a stand-in browser
(`home/fakeDom.ts`). That measures the script's own work, not painting; a real first-paint time on the
laptop is still to be taken.

| What | Before | After | Budget (test) |
| --- | --- | --- | --- |
| Page script | 82,761 characters | same | under 100,000 |
| Stylesheet without the three embedded fonts | 27,719 | same | under 40,000 |
| Whole document (fonts and the logo animation included) | 525,549 | same | under 560,000 |
| Text given to the window as a `data:` URL | 603,348 characters, percent-encoded and parsed on every open | none: the page is a file in the state folder, rewritten only when it changes | |
| Elements built for the first draw (Home) | 218 | same | under 300 |
| Elements built for the heaviest tab switch (Trust, 131) | 131 | same | under 200 |
| Tab switch time in the stand-in browser | about 1.5 ms | same | under 40 ms |

What is big: three embedded fonts are 226 KB and the logo animation is 189 KB. Both are visual
assets and belong to the visual-tokens owner; shrinking them (subsetting the fonts further, loading
the animation after the first paint) is the next real saving and is not done here.

`speedBudget.test.ts` fails when a number goes over its budget. Raise a budget only with a reason
written in this table.
