import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { SessionManager } from "./server/sessions.js";
import { createRouter, handleLegacyPrompt } from "./server/routes.js";
import {
  ensureDevLogsDir,
  stopAllManagedDevServers,
} from "./server/dev-logs.js";
import { PROJECTS_ROOT } from "./server/projects.js";
import { mountMcpProxy } from "./server/mcp-proxy.js";
import { blockPublicUi, localUiOnly } from "./server/tunnel-access.js";
import { requireRemoteApiKey } from "./server/remote-auth.js";
import { attachSessionWebSocket } from "./server/session-ws.js";
import {
  createTelegramWebhookHandler,
  maybeSetTelegramWebhookOnBoot,
} from "./server/telegram-operator.js";
import { startIdeAgentMirror } from "./server/telegram-ide-mirror.js";
import { isPhoneModeOn, setPhoneMode } from "./server/telegram-phone.js";
import {
  deleteTelegramWebhook,
  isTelegramEnabled,
} from "./server/telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4242);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = express();
const sessions = new SessionManager();
const server = http.createServer(app);

app.use(cors());
app.use(requireRemoteApiKey);
mountMcpProxy(app);
// Chat may include a few compressed JPEG attachments as base64.
app.use(express.json({ limit: "8mb" }));

app.post(
  "/cursor-bridge/telegram/webhook",
  createTelegramWebhookHandler(sessions),
);

app.use("/api", createRouter(sessions));

app.post("/prompt", (req, res) => handleLegacyPrompt(req, res));

const uiDist = path.join(__dirname, "ui", "dist");

app.get("/telegram", localUiOnly, (_req, res) => {
  res.sendFile(path.join(uiDist, "telegram.html"), (err) => {
    if (err) {
      res
        .status(503)
        .send("Telegram page not built. Run `pnpm build` in the ui package.");
    }
  });
});

app.use(blockPublicUi);

const examplesDir = path.join(__dirname, "examples");
app.use("/examples", localUiOnly, express.static(examplesDir));
app.use(localUiOnly, express.static(uiDist));
app.get(/^(?!\/api)(?!\/telegram)(?!\/cursor-bridge).*/, localUiOnly, (_req, res) => {
  res.sendFile(path.join(uiDist, "index.html"), (err) => {
    if (err) {
      res.status(200).send(`<!DOCTYPE html><html><body><h1>cursor-bridge</h1><p>API running. Build UI with <code>npm run build</code>.</p></body></html>`);
    }
  });
});

ensureDevLogsDir();
attachSessionWebSocket(server, sessions);

function shutdown() {
  stopAllManagedDevServers();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  console.log(`✅ Cursor bridge running on http://${HOST}:${PORT}`);
  console.log(`🔌 Session WebSocket: ws://${HOST}:${PORT}/api/sessions/:id/ws`);
  console.log(`📁 Projects root: ${PROJECTS_ROOT}`);
  if (!isTelegramEnabled()) {
    console.log("📴 Telegram disabled (TELEGRAM_ENABLED=0) — no outbound sends");
    if (isPhoneModeOn()) {
      setPhoneMode(false);
      console.log("📴 phone mode forced OFF");
    }
    void deleteTelegramWebhook()
      .then((r) => {
        if (r.ok) console.log("📴 Telegram webhook cleared");
      })
      .catch((err) => {
        console.warn(
          "[telegram] deleteWebhook on boot failed:",
          err instanceof Error ? err.message : err,
        );
      });
    return;
  }
  void maybeSetTelegramWebhookOnBoot();
  if (isPhoneModeOn()) {
    console.log("📲 phone mode already ON — starting IDE agent mirror");
    void startIdeAgentMirror(sessions).catch((err) => {
      console.warn(
        "[ide-mirror] boot start failed:",
        err instanceof Error ? err.message : err,
      );
    });
  }
});
