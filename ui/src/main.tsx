import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { Toaster } from "@/components/ui/toast";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NuqsAdapter>
      <Toaster>
        <App />
      </Toaster>
    </NuqsAdapter>
  </StrictMode>,
);
