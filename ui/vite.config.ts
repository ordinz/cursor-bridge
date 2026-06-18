import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
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
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        telegram: path.resolve(__dirname, "telegram.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4242",
      "/prompt": "http://127.0.0.1:4242",
    },
  },
});
