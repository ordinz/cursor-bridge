import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Mobile Safari/Chrome suspend the Vite HMR WebSocket when the tab is
 * backgrounded. On resume Vite's client polls, then calls location.reload() —
 * which feels like the whole app "reloads" every time you switch apps.
 * Reconnect HMR in place instead; real full-reloads still happen for
 * non-hot-reloadable edits via the normal `full-reload` message path.
 */
function tameHmrReconnectReload(): Plugin {
  const needle =
    "await waitForSuccessfulPing(url.href);\n\t\t\t\t\tlocation.reload();";
  const replacement = [
    "await waitForSuccessfulPing(url.href);",
    '\t\t\t\t\tconsole.info("[vite] server connection restored — reconnecting HMR (no reload)");',
    "\t\t\t\t\ttransport.connect(createHMRHandler(handleMessage));",
  ].join("\n");

  return {
    name: "tame-hmr-reconnect-reload",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("vite/dist/client/client.mjs") && !id.includes("/@vite/client")) {
        return;
      }
      if (!code.includes("location.reload()") || !code.includes("waitForSuccessfulPing")) {
        return;
      }
      if (!code.includes(needle)) {
        // Fall back to a looser match if Vite reformats the client.
        const loose = /await waitForSuccessfulPing\(url\.href\);\s*location\.reload\(\);/;
        if (!loose.test(code)) return;
        return {
          code: code.replace(
            loose,
            'await waitForSuccessfulPing(url.href); console.info("[vite] server connection restored — reconnecting HMR (no reload)"); transport.connect(createHMRHandler(handleMessage));',
          ),
          map: null,
        };
      }
      return { code: code.replace(needle, replacement), map: null };
    },
  };
}

export default defineConfig({
  plugins: [
    tameHmrReconnectReload(),
    react(),
    tailwindcss(),
    {
      name: "telegram-route",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/telegram" || req.url === "/telegram/") {
            req.url = "/telegram.html";
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        telegram: path.resolve(__dirname, "telegram.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    allowedHosts: ["ordins-cursor-bridge.kairose.com"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4242",
        changeOrigin: true,
        ws: true,
      },
      "/prompt": {
        target: "http://127.0.0.1:4242",
        changeOrigin: true,
      },
    },
  },
});
