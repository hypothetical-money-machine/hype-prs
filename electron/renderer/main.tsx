import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrWorkspace } from "../../components/pr-workspace";
import "../../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Hype renderer root is missing.");

createRoot(root).render(
  <StrictMode>
    <PrWorkspace />
  </StrictMode>,
);
