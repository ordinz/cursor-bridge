# @cursor-bridge/mcp

stdio MCP server that wraps the [cursor-bridge](../README.md) REST + SSE API at `http://127.0.0.1:4242/api`.

**Prerequisite:** the bridge must already be running (`pnpm start` from the repo root).

## Install

```bash
pnpm install && pnpm --filter @cursor-bridge/mcp build
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_BASE_URL` | `http://127.0.0.1:4242/api` | Bridge API base URL |
| `MCP_ALLOW_REMOTE` | unset | Set to `1` to allow non-localhost base URLs (not recommended) |

## Tools

| Tool | Description |
|------|-------------|
| `run_oneshot` | **Default** — one-shot prompt (create → chat → close) |
| `health` | Bridge + Cursor connectivity |
| `list_projects` | Allowlisted projects |
| `list_models` | Available models |
| `create_session` | New multi-turn session |
| `resume_session` | Resume persisted agent |
| `get_session` | Session state |
| `list_agents` | Persisted agents for a project |
| `delete_agent` | Remove persisted agent |
| `send_prompt` | Send prompt and wait for SSE completion |
| `cancel_run` | Cancel active run |
| `close_session` | Close session |

Bridge errors (`SESSION_BUSY`, `SESSION_NOT_FOUND`, etc.) are returned as MCP `isError: true` responses with the error code in the message.

---

## Perplexity (Mac app)

1. Install the **PerplexityXPC** helper if prompted.
2. Open **Perplexity → Settings → Connectors → Add Connector**.
3. Choose the **Simple** tab.
4. Configure:
   - **Server Name:** `cursor-bridge`
   - **Command:** `node /absolute/path/to/cursor-bridge/mcp/dist/index.js`
5. Enable the connector under **Sources**.

Replace `/absolute/path/to/cursor-bridge` with your clone path (run `pnpm --filter @cursor-bridge/mcp build` first).

---

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cursor-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/cursor-bridge/mcp/dist/index.js"],
      "env": {
        "BRIDGE_BASE_URL": "http://127.0.0.1:4242/api"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cursor-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/cursor-bridge/mcp/dist/index.js"],
      "env": {
        "BRIDGE_BASE_URL": "http://127.0.0.1:4242/api"
      }
    }
  }
}
```

Restart Cursor or reload MCP servers from settings.

---

## Manual test

With the bridge running:

```bash
npx @modelcontextprotocol/inspector node mcp/dist/index.js
```

Or from the repo root after build:

```bash
node mcp/dist/index.js
```

Use the MCP Inspector to list tools and call `health` or `run_oneshot`.

---

## Development

```bash
pnpm mcp:dev    # watch TypeScript
pnpm mcp:build  # compile to mcp/dist/
```
