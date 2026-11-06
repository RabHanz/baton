# Tessaya for outside agents

An agent you connect to this computer's MCP URL, as described in [Outside agents](./outside-agents.md), also gets Tessaya's own tools. Nothing new needs setting up. The tools that look work at every access level, read only included.

## What it can see

- `tessaya_jobs` and `tessaya_watch`: jobs, their parts, and work that looks stuck or waits for you.
- `tessaya_record`: what happened, who did it and for which project.
- `tessaya_rules`: standing rules and when they last fired.
- `tessaya_sessions`: the Claude Code sessions on this computer, by title and folder.
- `tessaya_memory_search`: what Tessaya remembers.

## Asking her to do something

`tessaya_ask` passes a request to Tessaya on this computer, such as "stop job 7", and `tessaya_ask_status` shows where it stands. She treats it as a request from a paired device, not from you: she asks you before she does anything, every time, and you can say no. An agent with read-only access cannot ask, and nothing is asked while Tessaya's desktop app is closed. A request waits five minutes for it. Each agent can have one request waiting at a time, and agents three in all, so they never crowd out your phone.

## Good to know

- Through Tessaya's tools an agent cannot approve, grant or widen anything, and it cannot act as you: every request still waits for your yes.
- Walls cover memory only: a walled project's memories never reach an outside agent. Jobs, the Record and sessions show every project.
- They are shown only to agents signed in from outside. The agents T3 Code runs in your threads do not get them.
- To check what an agent got, run `claude mcp list`, then ask it to list the Tessaya tools.
- Revoking the agent in **Settings → Sharing & access** ends its Tessaya access too.
