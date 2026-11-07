# Jobs and approvals

Give Tessaya a task and let a coding agent do it in the background.

## Start

Say or type what you want done as a job ("fix the failing build in the shop project"). A worker makes a plan first. The plan appears under **Approvals** with the exact thing your yes would allow and the permissions it would use. Agree and it starts; decline and it stops.

## Good to know

- **Approvals** is the one list of everything waiting for your yes: job plans, questions a session asked you, held memory suggestions, the vault asking to use a secret.
- A job has limits (time, turns, optionally money). It stops at them and tells you; raise a limit to let it go on.
- Only Tessaya, the lead, starts and splits jobs. Once you agree a plan, say "split it" and she hands each part to one of your personas by name (Alfred, Sebastian, Freya): each part runs in its own thread with that persona's brief, model and `tools` from its pack file, and its outcome goes to what happened under its name. Ask Freya to start a job and she will tell you to ask Tessaya.
- Each persona's background turns are counted per day. The guide is 40 a persona and 120 for the team: passing it is noted once that day in what happened and in the next morning brief, and nothing is stopped. Talking with Tessaya is never counted.
- **Standing jobs** (Trust page) are the work that runs by itself: the morning brief, a look at a failed build, a reminder about a session waiting on you, a summary when a job finishes, every rule you set up ("when the build finishes, have Codex review it") and every job on a schedule. Each shows which persona runs it and how many times it has run. One runs unattended only where that persona may do it without asking (reading and reporting); anything else is held and logged. They run with T3's window closed, and each run is in what happened.
- **Stop** ends a running turn; the job and its notes stay. **Retry** is offered only for a job that failed and has retries left, and says why not otherwise.
- A job that a restart interrupted shows a Continue button.
- **Sessions** lists every live session on this computer and on each computer its server is linked to, with T3's window open or closed. With the window closed, you can type only into this computer's sessions; open T3 to type into another computer's, so your words go over T3's own connection to it and never over a link, where they would arrive as another agent's. A computer linked read-only never takes typing.
- **What needs me** (the Now page) ranks what to look at first: failures, questions, stalled work.

## Run on

Say where a job runs: "start it on the studio computer" (any computer connected to your Tessaya, by the name shown in the sidebar), or leave it out to run it on this computer. The project has to exist on that computer. Later calls about the job (agree, stop, refine) go to the computer it runs on, and the jobs list shows all of them with where each runs.
