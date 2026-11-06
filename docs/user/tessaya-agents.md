# Tessaya for outside agents

An agent you connect to this computer's MCP URL, as described in [Outside agents](./outside-agents.md), also gets Tessaya's own tools. Nothing new needs setting up, and they work at every access level, read only included.

## What it can see

- `tessaya_jobs` and `tessaya_watch`: jobs, their parts, and work that looks stuck or waits for you.
- `tessaya_record`: what happened, who did it and for which project.
- `tessaya_rules`: standing rules and when they last fired.
- `tessaya_sessions`: the Claude Code sessions on this computer, by title and folder.
- `tessaya_memory_search`: what Tessaya remembers.

## Good to know

- Tessaya's tools only read. Through them an agent cannot approve, grant or widen anything, and it cannot act as you.
- Walls cover memory only: a walled project's memories never reach an outside agent. Jobs, the Record and sessions show every project.
- They are shown only to agents signed in from outside. The agents T3 Code runs in your threads do not get them.
- To check what an agent got, run `claude mcp list`, then ask it to list the Tessaya tools.
- Revoking the agent in **Settings → Sharing & access** ends its Tessaya access too.
