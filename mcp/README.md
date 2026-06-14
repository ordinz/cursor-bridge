# @cursor-bridge/mcp

HTTP MCP server (Streamable HTTP + legacy SSE) that wraps the [cursor-bridge](../README.md) REST + SSE API.

**Prerequisite:** the bridge must be running locally (`pnpm bridge`).

## Install

```bash
pnpm install && pnpm --filter @cursor-bridge/mcp build
```

## Start

```bash
# terminal 1 — bridge API
pnpm bridge

# terminal 2 — MCP HTTP server (default :4243)
pnpm mcp:start
```

Endpoints:

| Path | Transport |
|------|-----------|
| `POST/GET/DELETE /mcp` | **Streamable HTTP** (use this in Perplexity) |
| `GET /sse` + `POST /messages` | Legacy MCP SSE (older clients) |
| `GET /health` | Sanity check (not MCP) |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `4243` | MCP HTTP listen port |
| `MCP_HOST` | `127.0.0.1` | Bind address |
| `MCP_ALLOWED_HOSTS` | — | Comma-separated `Host` values allowed through Cloudflare (e.g. `bridge.example.com`) |
| `MCP_API_KEY` | — | Require `Authorization: Bearer <key>` on MCP routes (strongly recommended behind a tunnel) |
| `BRIDGE_BASE_URL` | `http://127.0.0.1:4242/api` | Upstream bridge API |
| `BRIDGE_API_KEY` | — | Bearer token for bridge API (when bridge auth is enabled) |
| `MCP_ALLOW_REMOTE` | unset | Set to `1` to allow non-localhost `BRIDGE_BASE_URL` |

Generate an MCP API key:

```bash
openssl rand -hex 32
```

Add to `.env`:

```bash
MCP_API_KEY=your_generated_key
MCP_ALLOWED_HOSTS=your-tunnel-host.example.com
```

## Cloudflare tunnel

Your tunnel must reach the **MCP port (4243)**, not the bridge UI/API (4242).

**Wrong** (returns HTML / `Cannot POST /mcp`):

```yaml
service: http://127.0.0.1:4242
```

**Option A — MCP only** (simplest):

```yaml
ingress:
  - hostname: c11c4cdb-ee6b-4e5e-a0ef-4082510bef26.kairose.com
    service: http://127.0.0.1:4243
  - service: http_status:404
```

Perplexity URL: `https://c11c4cdb-ee6b-4e5e-a0ef-4082510bef26.kairose.com/mcp`

**Option B — MCP + bridge on one hostname** (path routing):

```yaml
ingress:
  - hostname: your-host.example.com
    path: /mcp
    service: http://127.0.0.1:4243
  - hostname: your-host.example.com
    path: /sse
    service: http://127.0.0.1:4243
  - hostname: your-host.example.com
    path: /messages
    service: http://127.0.0.1:4243
  - hostname: your-host.example.com
    service: http://127.0.0.1:4242
```

Set `MCP_ALLOWED_HOSTS=your-host.example.com` so the MCP SDK accepts the tunneled `Host` header.

Test (should return JSON, not HTML):

```bash
curl -s https://your-host.example.com/health
curl -s -H "Authorization: Bearer $MCP_API_KEY" https://your-host.example.com/health
```

---

## Perplexity (Custom connector)

1. **Settings → Connectors → Add Custom connector**
2. **MCP Server URL:** `https://mcp.yourdomain.com/mcp`
3. **Transport:** **Streamable HTTP**
4. **Authentication:** if Perplexity offers Bearer / API key, use your `MCP_API_KEY`. OAuth (`client_id` / `client_secret`) is **not** implemented — Perplexity may require Bearer auth or open/none on a trusted tunnel.

Enable the connector under **Sources** in a thread.

---

## Tools

| Tool | Description |
|------|-------------|
| `run_oneshot` | One-shot prompt (create → chat → close) |
| `health` | Bridge + Cursor connectivity |
| `list_projects` | Allowlisted projects |
| `list_models` | Available models |
| `create_session` | New multi-turn session |
| `resume_session` | Resume persisted agent |
| `get_session` | Session state |
| `list_agents` | Persisted agents |
| `delete_agent` | Remove persisted agent |
| `send_prompt` | Send prompt and wait for SSE completion |
| `cancel_run` | Cancel active run |
| `close_session` | Close session |

---

## Development

```bash
pnpm mcp:dev    # watch TypeScript
pnpm mcp:build  # compile to mcp/dist/
```
