import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { SessionManager } from "./server/sessions.js";
import { createRouter, handleLegacyPrompt } from "./server/routes.js";
import { PROJECTS_ROOT } from "./server/projects.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4242);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = express();
const sessions = new SessionManager();

app.use(cors());
app.use(express.json());

app.use("/api", createRouter(sessions));

app.post("/prompt", (req, res) => handleLegacyPrompt(req, res, sessions));

const uiDist = path.join(__dirname, "ui", "dist");
app.use(express.static(uiDist));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(uiDist, "index.html"), (err) => {
    if (err) {
      res.status(200).send(`<!DOCTYPE html><html><body><h1>cursor-bridge</h1><p>API running. Build UI with <code>npm run build</code>.</p></body></html>`);
    }
  });
});

app.listen(PORT, HOST, () => {
  console.log(`✅ Cursor bridge running on http://${HOST}:${PORT}`);
  console.log(`📁 Projects root: ${PROJECTS_ROOT}`);
});
