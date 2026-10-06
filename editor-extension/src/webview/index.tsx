import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { DiagramPanelApp } from "./DiagramPanelApp.js";
import { connectBridge } from "./bridge.js";

const container = document.getElementById("root");
if (!container) throw new Error("Missing sidebar root");
const bridge = connectBridge();
const root = createRoot(container);
root.render(
  document.body.dataset.view === "diagram" ? (
    <DiagramPanelApp bridge={bridge} />
  ) : (
    <App bridge={bridge} />
  ),
);
window.addEventListener("pagehide", () => root.unmount(), { once: true });
