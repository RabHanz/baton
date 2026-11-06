# The window's speed

Measured 2026-11-03 on a Linux box with the page script run in Node against a stand-in browser
(`home/fakeDom.ts`). That measures the script's own work, not painting; a real first-paint time on the
laptop is still to be taken.

| What                                                    | Before                                                       | After                                                                        | Budget (test) |
| ------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------- |
| Page script                                             | 82,761 characters                                            | same                                                                         | under 113,000 |
| Stylesheet without the three embedded fonts             | 27,719                                                       | same                                                                         | under 42,500  |
| Whole document (fonts and the logo animation included)  | 525,549                                                      | same                                                                         | under 740,000 |
| Text given to the window as a `data:` URL               | 603,348 characters, percent-encoded and parsed on every open | none: the page is a file in the state folder, rewritten only when it changes |               |
| Elements built for the first draw (Home)                | 218                                                          | same                                                                         | under 300     |
| Elements built for the heaviest tab switch (Trust, 131) | 131                                                          | same                                                                         | under 200     |
| Tab switch time in the stand-in browser                 | about 1.5 ms                                                 | same                                                                         | under 40 ms   |

What is big: three embedded fonts are 226 KB and the logo animation is 344 KB. The animation grew from 189 KB
on 2026-11-05 when the sting went from 40 frames at 20 fps (2 s, jerky) to 90 real frames at 30 fps (3 s), which
raised the document budget to 690,000. On 2026-11-06 the sting became 108 frames over 3.6 s (slower, so the splash
settles before the window takes over): the animation is 344 KB and the budget 740,000. Both are visual
assets and belong to the visual-tokens owner; shrinking them (subsetting the fonts further, loading
the animation after the first paint) is the next real saving and is not done here.

The page script budget is 112,000 since 2026-11-05: the greeting picker and its 50 lines added about 4,400 characters. It is 113,000 since 2026-11-06: the marks became buttons that play on click, about 900 characters.

The stylesheet budget is 41,500 since 2026-11-05: the Damson and Madder palettes add a light and a dark accent rule each. It is 42,500 since 2026-11-06: the glass tokens, the marks' hover and click breaths, and the Settings window's larger frame.

`speedBudget.test.ts` fails when a number goes over its budget. Raise a budget only with a reason
written in this table.
