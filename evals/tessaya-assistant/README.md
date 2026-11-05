# Tessaya assistant

Runs Tessaya's one assistant as it ships: the real `AGENT_PROMPT`, the real tool list on the real MCP server, and a real `claude -p` session. It scores which tool the assistant reaches for first after one spoken sentence. Every tool call is recorded and refused, so nothing runs on your machine.

## Run

```sh
cd evals
pnpm tessaya-assistant --out runs/assistant
pnpm tessaya-assistant --out runs/assistant-haiku --model haiku --case needs-me --samples 1
```

- It uses your own `claude` login (subscription; metered API variables are stripped). `--claude <path>` picks the binary.
- Flags: `--model` (default `claude-opus-5-5`), `--effort` (default `medium`; Haiku takes none), `--case <id>` (repeatable), `--samples <n>` (default 2).
- A case passes when more than half its samples reach first for a tool in `first` and not one in `not`.
- A run writes `results.json` and `summary.md`, with the median time a sample took (a cold `claude` start included, so compare runs made one at a time).
- Cost: about 25k input tokens a sample, mostly cached; a full run is 40 samples.

## Add a case

Add an entry to `cases.ts` with an `id`, its `source`, the sentence `said`, and the acceptable `first` tools (`none` for a plain answer). Add `not` for a wrong first move the case guards against. A case with `wake` runs as that persona from the default roster; `says` lists words the reply must contain. `answers` lets named tools run with a fixed text, built from the shipped formatter, so a case can check what the reply says about it.
