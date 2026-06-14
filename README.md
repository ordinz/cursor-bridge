# cursor-bridge

Local HTTP bridge between external AI agents and the Cursor SDK, plus a human oversight UI.

**Primary operator:** an external AI agent calling the REST/SSE API.  
**Secondary operator:** a human monitoring tool activity, stopping runs, and injecting manual prompts.

## Quick start

```bash
cp .env.example .env   # add CURSOR_API_KEY
pnpm install
pnpm start
```

If you see a `sqlite3` bindings error after install, pnpm blocked native builds — reinstall:

```bash
rm -rf node_modules
pnpm install
```

Default (**dev**): bridge API on `:4242`, MCP on `:4243`, oversight UI with HMR on `:5173`.

Single-port (**prod**): built UI + API together on `:4242`, MCP still on `:4243`:

```bash
pnpm start -- --prod
```

API-only (no UI or MCP):

```bash
pnpm bridge
```

## Ports

| Command | API | MCP | UI |
|---------|-----|-----|-----|
| `pnpm start` | http://127.0.0.1:4242/api/* | http://127.0.0.1:4243/mcp | http://localhost:5173 |
| `pnpm start -- --prod` | http://127.0.0.1:4242/api/* | http://127.0.0.1:4243/mcp | http://127.0.0.1:4242 |
| `pnpm bridge` | http://127.0.0.1:4242/api/* | — | static build if present |
| `pnpm mcp:start` | (needs bridge) | http://127.0.0.1:4243/mcp | — |

Agents should always target `http://127.0.0.1:4242/api/*`.

See **[AGENT_API.md](./AGENT_API.md)** for the machine-oriented client contract (SSE schema, error codes, browser examples).

- OpenAPI: `GET /api/openapi.json`
- Browser demo: `examples/browser-client.html` (served at `/examples/browser-client.html` in prod mode)

## MCP server

HTTP MCP server for **Perplexity Custom connector**, Cloudflare tunnel, and other remote MCP clients:

```bash
pnpm install
pnpm start       # bridge :4242 + MCP :4243 (+ UI in dev)
```

Or run MCP alone (requires `pnpm bridge` in another terminal):

```bash
pnpm mcp:build && pnpm mcp:start
```

See **[mcp/README.md](./mcp/README.md)** for tunnel setup, `MCP_API_KEY`, and Perplexity registration.

For **Cursor / Claude Desktop** (local stdio), use the REST API in [AGENT_API.md](./AGENT_API.md) or run the MCP HTTP server locally at `http://127.0.0.1:4243/mcp`.

## Project scope

Agents may only work inside **`~/dev/mx/https`**. By default only **`www`** and **`app`** are enabled for new sessions; other subdirectories appear in the list but are disabled.

```bash
curl http://127.0.0.1:4242/api/projects
```

## API (agent contract)

### `GET /api/health`

### `GET /api/projects`

Returns allowlisted projects under `~/dev/mx/https`.

### `GET /api/models`

Lists models available to your API key (`Cursor.models.list()`).

### `GET /api/agents?project=app`

Lists persisted local agents for a project cwd.

### `DELETE /api/agents/:agentId?project=app`

Delete a persisted local agent and its runs/checkpoints.

### `POST /api/sessions`

```json
{ "project": "app", "model": "default" }
```

Returns `{ sessionId, agentId, project, cwd, model, runStatus }`.

### `POST /api/sessions/resume`

```json
{ "agentId": "...", "project": "app", "model": "default" }
```

### `POST /api/sessions/:id/chat` (SSE)

```json
{ "prompt": "Explain this repo" }
```

SSE events:

```json
{ "type": "assistant", "text": "..." }
{ "type": "tool_call", "callId": "...", "name": "read", "status": "running", "args": {} }
{ "type": "tool_call", "status": "completed", "result": "..." }
{ "type": "status", "status": "RUNNING" }
{ "type": "session", "sessionId": "...", "agentId": "..." }
{ "type": "done", "runId": "...", "status": "finished" }
{ "type": "error", "message": "..." }
```

### `POST /api/sessions/:id/cancel`

Cancel the active run.

### `DELETE /api/sessions/:id`

Cancel run and close agent.

### `POST /prompt` (legacy)

Single-turn alias — creates a ephemeral agent, streams text, closes. Same `{ prompt, project, model }` body.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_API_KEY` | — | Required |
| `PORT` | `4242` | Listen port |
| `HOST` | `127.0.0.1` | Bind address |
| `PROJECTS_ROOT` | `~/dev/mx/https` | Project allowlist root |
| `ENABLED_PROJECTS` | `www,app` | Comma-separated projects selectable for new sessions |
| `SESSION_IDLE_MS` | `1800000` | Session idle timeout (30 min) |

## Security

Localhost-only bind by default. Do not expose publicly without `MCP_API_KEY` — the bridge runs Cursor agents with filesystem access using your API key.

**Remote access (tunnel hostname):** all routes require `Authorization: Bearer <MCP_API_KEY>` (or `X-API-Key`). **Localhost stays open** for local dev (`pnpm start`, UI, MCP on `:4243`). The oversight UI is never served on tunnel hostnames.
