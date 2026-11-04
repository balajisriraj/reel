import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./studio/App";
import { ToastHost } from "./studio/ui";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastHost>
      <App />
    </ToastHost>
  </StrictMode>,
);
