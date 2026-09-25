import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";

const UNA_HORA = 60 * 60 * 1000;

// El service worker está en modo autoUpdate: en cuanto detecta una versión nueva, la instala y
// recarga. El problema es CUÁNDO la detecta: por defecto solo al navegar, y una PWA añadida a la
// pantalla de inicio de iOS puede pasar días sin navegar, quedándose con una versión vieja sin que
// se note. Por eso se comprueba cada hora y al volver a primer plano.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registro) {
    if (!registro) return;
    const comprobar = () => { if (navigator.onLine) registro.update().catch(() => {}); };
    setInterval(comprobar, UNA_HORA);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) comprobar(); });
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
