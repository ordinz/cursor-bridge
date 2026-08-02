# cursor-bridge

Local HTTP bridge between external AI agents and the Cursor SDK, plus a human oversight UI and macOS menu bar controls.

**Primary operator:** an external AI agent calling the REST/SSE API.  
**Secondary operator:** a human monitoring tool activity, stopping runs, and injecting manual prompts — via the **oversight UI** or the **SwiftBar menu bar plugin**.

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

## Oversight UI

The oversight UI is a React agent console for sending prompts and watching agents work. Open it at **http://127.0.0.1:5173** in dev (`pnpm start`) or **http://127.0.0.1:4242** in prod (`pnpm start -- --prod`).

**If you are on this page, use the Prompt form — not MCP.** MCP is a separate integration path for Cursor IDE agents.

| Area | What it does |
|------|----------------|
| **Conversation** | Live stream of prompts, assistant replies, and run status over SSE |
| **Prompt** | Type a task and press Send — the primary way to dispatch work from the browser UI |
| **Instructions** | Self-explanatory guide for AI operators viewing the page (includes "do not use MCP" callout) |
| **Session sidebar** | Browse and resume past agents per project; delete history |
| **Header controls** | Pick project and model, start a new session, stop a running agent |
| **Status bar** | Bridge health, Cursor readiness, version, session cwd/model, run state |

Tool calls are hidden by default in the conversation feed; toggle **Show tool calls** to reveal them. The layout uses a tab bar (History, Conversation, Instructions) on all screen sizes. Health is polled every 30 seconds; the footer mirrors the same green/amber/red signals the SwiftBar plugin uses.

## Menu bar (macOS)

Run cursor-bridge from the menu bar with [SwiftBar](https://swiftbar.app). The plugin lives at [`scripts/menubar/cursor-bridge.10s.sh`](scripts/menubar/cursor-bridge.10s.sh) and polls API + UI health every 10 seconds.

**Install**

Plugins live in [`scripts/menubar/`](scripts/menubar/). Symlink them into your SwiftBar folder (default `~/swiftbar`):

```bash
brew install --cask swiftbar
./scripts/menubar/install.sh
```

Or link individually:

```bash
ln -sf "$(pwd)/scripts/menubar/cursor-bridge.10s.sh" "$HOME/swiftbar/cursor-bridge.10s.sh"
ln -sf "$(pwd)/scripts/menubar/mbp-tunnel.30s.sh" "$HOME/swiftbar/mbp-tunnel.30s.sh"
```

Point SwiftBar at your plugins folder (e.g. `~/swiftbar`) in SwiftBar → Preferences.

**Indicator**

| Icon | Meaning |
|------|---------|
| 🟢 | API + UI up, no agent runs in progress |
| 🟡 | API + UI up and at least one agent is actively running |
| 🟠 | API up but UI down (orphaned bridge — watchdog should heal this) |
| ⚫ | Stopped |

**Watchdog:** `pnpm start:bg` (and menu **Start**) also launches a background healer that checks API + UI every 3 minutes and restarts the stack if Vite or the supervisor dies while the API orphan stays up. **Stop** kills the watchdog too. Logs: `/tmp/cursor-bridge-watchdog.log`.

The plugin polls every 10 seconds. Rename the file to `cursor-bridge.3s.sh` (and update the symlink) for faster yellow/green transitions when agents start and finish.

**Menu actions**

| Action | What it does |
|--------|----------------|
| **Start** | Launch detached dev stack + watchdog (`start-bg.sh`) |
| **Stop** | Stop listeners on `:4242`, `:4243`, `:5173`, supervisor, and watchdog |
| **Open UI** | Open the oversight dashboard at `http://127.0.0.1:5173` |
| **View log** | Open `/tmp/cursor-bridge.log` |
| **Watchdog log** | Open `/tmp/cursor-bridge-watchdog.log` |
| **GitHub** | Open the [cursor-bridge repo](https://github.com/ordinz/cursor-bridge) |
| **Cloudflare tunnel** | Open [tunnel routes](https://dash.cloudflare.com/5a4fdf7e9a52050c3677ebe502a344d0/tunnels/e98e39df-8b06-4379-b390-a372472284e9/routes) in the Cloudflare dashboard |
| **Refresh** | Re-poll health immediately |

CLI equivalents:

```bash
pnpm start:bg   # start detached stack + watchdog
pnpm stop       # stop stack + watchdog
pnpm watchdog   # run healer in the foreground (usually unnecessary)
```

### Tunnel status (`mbp.thematrixofdestiny.com`)

A second SwiftBar plugin ([`scripts/menubar/mbp-tunnel.30s.sh`](scripts/menubar/mbp-tunnel.30s.sh)) polls the public tunnel hostname every 30 seconds and checks whether `cloudflared` is running locally. Installed by `install.sh` above.

| Icon | Meaning |
|------|---------|
| `:globe:` (green) | Tunnel reachable (HTTPS response from Cloudflare edge) |
| `:icloud.and.arrow.up:` (orange) | `cloudflared` is running but the hostname is unreachable (HTTP 530) |
| `:icloud.slash:` (gray) | Tunnel offline (`cloudflared` stopped and hostname unreachable) |

Override the hostname with `TUNNEL_HOST` in the environment if needed.

## Telegram phone console (`Cursor Bridge` forum)

Remote operator console over Telegram. Default **off** so laptop work does not stream to your phone until you send `/phone on`.

### Cloudflare hostname (dedicated — do not use `mbp`)

`mbp.thematrixofdestiny.com` stays on the Next app (`:3000`). MCP stays on its existing published app:

| Hostname | Service |
|----------|---------|
| `cursor-mcp-bridge.kairose.com` | `http://127.0.0.1:4243` (MCP — unchanged) |
| `cursor-bridge.kairose.com` | `http://127.0.0.1:4242` (**add this** — API + Telegram webhook) |
| `mbp.thematrixofdestiny.com` | `http://localhost:3000` (app — unchanged) |

In Cloudflare Zero Trust → Networks → Tunnels → your tunnel → **Published application routes**, add:

- **Hostname:** `cursor-bridge.kairose.com`
- **Service:** `http://127.0.0.1:4242`

DNS for `*.kairose.com` should already be on this tunnel (same as MCP).

Webhook URL:

`https://cursor-bridge.kairose.com/cursor-bridge/telegram/webhook`

### One-time group setup

1. Create a private Telegram group named **`Cursor Bridge`**.
2. Enable **Topics** (forum mode) in group settings.
3. Create at least the **`Status`** topic (or let the bot create all topics in step 7).
4. Add your bot (same `TELEGRAM_BOT_TOKEN` as outbound notify, **not** the Matrix support-chat bot).
5. Make the bot an admin with **Manage topics** + **Post messages**.
6. In BotFather → your bot → **Group Privacy → Turn off** (so free-text prompts are visible).
7. Create / sync forum topics for each enabled project:

```bash
pnpm telegram:create-topics
```

This creates missing topics (`Status`, `app`, `www`, `admin`, `email`, `cursor-bridge`, …) via Bot API and writes `TELEGRAM_TOPIC_*` into `.env`. Or discover ids manually with `pnpm telegram:setup-topics` after posting in each topic.

Generate a webhook secret:

```bash
openssl rand -hex 24   # → TELEGRAM_WEBHOOK_SECRET
```

Optional: `TELEGRAM_ALLOWED_USER_IDS` = your numeric user id.

Also set:

```bash
TELEGRAM_TUNNEL_HOST=cursor-bridge.kairose.com
# or full override:
# TELEGRAM_WEBHOOK_PUBLIC_URL=https://cursor-bridge.kairose.com/cursor-bridge/telegram/webhook
```

8. Start the bridge, then:

```bash
pnpm telegram:set-webhook
```

### Commands

| Command | Effect |
|---------|--------|
| `/phone_on` | Enable prompts + live draft streaming to Telegram |
| `/phone_off` | Disable sync (default) |
| `/status` | Health, sessions, phone mode |
| `/stop` | Cancel active run(s) for this topic’s project (or all from Status) |
| `/new` | Fresh session in the current project topic |
| `/help` | List commands |

Also accepted when typed: `/phone on` · `/phone off`.

Slash-menu preview is registered via Bot API `setMyCommands` (on bridge boot, or manually):

```bash
pnpm telegram:set-commands
```

If `/` still shows nothing, force-quit Telegram and reopen, or run the command above after changing the bot token.

Plain text in a **project topic** (`app`, `www`, `admin`, `email`, `cursor-bridge`, …) while phone mode is on becomes a Cursor prompt for that repo. Replies stream via rich drafts when available, then persist as one rich HTML message.

### Smoke test

1. Status topic → `/status` or `/help`
2. `/phone_on`
3. app (or admin/email) topic → short prompt → draft then final message
4. `/phone_off`

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

Agents may only work inside allowlisted project roots. Default enable list:

`www`, `app`, `admin`, `email`, `cursor-bridge`

Most live under **`~/dev/mx/https/<id>`**. `cursor-bridge` uses `PROJECT_PATH_OVERRIDES` (default `~/dev/cursor-bridge`).

```bash
# ENABLED_PROJECTS=www,app,admin,email,cursor-bridge
# PROJECT_PATH_OVERRIDES=cursor-bridge:/Users/you/dev/cursor-bridge
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
{ "prompt": "Explain this repo", "includeDevLogs": false }
```

When `includeDevLogs` is `true`, recent local dev server output for the session project is prepended to the agent prompt. The SSE `user` event still shows the original prompt text.

## Local dev server logs

The oversight UI includes an **Include dev logs** checkbox on the prompt form. When checked, the bridge prepends recent output from the project's local `pnpm dev` server (`app` on `:3000`, `www` on `:3001`).

**`app` and `www` write logs automatically.** Their `pnpm dev` scripts tee stdout/stderr to `~/.cursor-bridge/dev-logs/{project}.log`. Just run `pnpm dev` as usual.

The bridge can also start a managed dev server (optional fallback):

```bash
curl -X POST http://127.0.0.1:4242/api/projects/app/dev-server \
  -H 'Content-Type: application/json' \
  -d '{"action":"start"}'
```

| Route | Purpose |
|-------|---------|
| `GET /api/projects/:id/dev-status` | Port reachability + log capture status |
| `GET /api/projects/:id/dev-logs?lines=150` | Preview recent log lines |
| `POST /api/projects/:id/dev-server` | `{ "action": "start" \| "stop" }` bridge-managed dev |

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
| `ENABLED_PROJECTS` | `www,app,admin,email,cursor-bridge` | Comma-separated projects selectable for new sessions |
| `PROJECT_PATH_OVERRIDES` | `cursor-bridge:~/dev/cursor-bridge` | Absolute path overrides outside `PROJECTS_ROOT` |
| `SESSION_IDLE_MS` | `1800000` | Session idle timeout (30 min) |
| `TELEGRAM_BOT_TOKEN` | — | Bot token (outbound + phone console) |
| `TELEGRAM_CHAT_ID` | — | `Cursor Bridge` forum group id |
| `TELEGRAM_WEBHOOK_SECRET` | — | Webhook `secret_token` / header check |
| `TELEGRAM_TOPIC_STATUS` | — | Status topic `message_thread_id` |
| `TELEGRAM_TOPIC_APP` | — | app topic thread id |
| `TELEGRAM_TOPIC_WWW` | — | www topic thread id |
| `TELEGRAM_TOPIC_ADMIN` | — | admin topic thread id |
| `TELEGRAM_TOPIC_EMAIL` | — | email topic thread id |
| `TELEGRAM_TOPIC_CURSOR_BRIDGE` | — | cursor-bridge topic thread id |
| `TELEGRAM_ALLOWED_USER_IDS` | — | Optional allowlist (comma-separated) |
| `TELEGRAM_WEBHOOK_PUBLIC_URL` | derived from `TELEGRAM_TUNNEL_HOST` | Full webhook URL |
| `TELEGRAM_TUNNEL_HOST` | `cursor-bridge.kairose.com` | Dedicated Cloudflare hostname → `:4242` |
| `TUNNEL_HOST` | `mbp.thematrixofdestiny.com` | SwiftBar app-tunnel poller only |
| `TELEGRAM_SET_WEBHOOK_ON_BOOT` | `1` | Set `0` to skip auto `setWebhook` |

## Security

Localhost-only bind by default. Do not expose publicly without `MCP_API_KEY` — the bridge runs Cursor agents with filesystem access using your API key.

**Remote access (tunnel hostname):** all routes require `Authorization: Bearer <MCP_API_KEY>` (or `X-API-Key`), except `POST /cursor-bridge/telegram/webhook` which uses `X-Telegram-Bot-Api-Secret-Token`. **Localhost stays open** for local dev (`pnpm start`, UI, MCP on `:4243`). The oversight UI is never served on tunnel hostnames.
