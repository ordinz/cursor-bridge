import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { TelegramPage } from "./pages/TelegramPage.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TelegramPage />
  </StrictMode>,
);
