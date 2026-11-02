# Connectors: calendar, mail and chat

Let Tessaya (through Claude Code) reach your calendar, your mail or your chat.

## Start

Open the **Skills** page and find **Connectors**. Calendar, mail and chat each say whether one is connected. To connect one, paste the https address of an MCP server you trust (or the command that starts one) and press **Review**.

## What to know

- **Tessaya names no vendor and ships no connector.** You bring the server. It does not check the server for you.
- **A card shows the exact command** (`claude mcp add ...`), where your data would go, what the server can reach and do, and what to be careful about. Nothing is added until you press Connect.
- A server you start with a command (for example one run through `npx`) downloads and runs code from the internet each time; the card says so.
- The first time Claude Code uses a remote server it asks you to sign in with that service.
- Anything read from your mail or chat is treated as information, never as instructions. Sending, posting and changing events still ask you first.
- Remove one later with `claude mcp remove <name>`; the name is on the card.
