import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import "./index.css";
import { TelegramPage } from "./pages/TelegramPage.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NuqsAdapter>
      <TelegramPage />
    </NuqsAdapter>
  </StrictMode>,
);
