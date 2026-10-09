import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchView } from "./components/SearchView";
import { HistoryView } from "./components/HistoryView";
import { DictionariesView } from "./components/DictionariesView";
import { SettingsView } from "./components/SettingsView";
import { SyncBanner } from "./components/SyncBanner";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { crearT, idiomaDelSistema, localeDe } from "./i18n";
import { copiaAutomaticaSiToca } from "./copia";

type Tab = "search" | "history" | "dicts" | "settings";

/** ¿Se está escribiendo en un campo de texto? (input de texto o textarea; no casillas ni botones). */
const esCampoDeTexto = (el: Element | null) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !["checkbox", "radio", "file", "button", "submit", "range", "color"].includes(el.type));

/**
 * En el móvil, con el teclado abierto, la barra de pestañas (position: fixed; bottom: 0) se sube
 * encima del teclado y tapa los resultados. Mientras se escribe se esconde. Solo con pantalla
 * táctil: en el ordenador no hay teclado en pantalla y la barra puede quedarse.
 */
function useEscribiendoEnMovil(): boolean {
  const [escribiendo, setEscribiendo] = useState(false);
  useEffect(() => {
    const tactil = window.matchMedia("(pointer: coarse)");
    const actualizar = () => setEscribiendo(tactil.matches && esCampoDeTexto(document.activeElement));
    // focusout llega antes de que el foco pase al siguiente campo: se mira en el siguiente ciclo.
    const alSalir = () => setTimeout(actualizar, 0);
    document.addEventListener("focusin", actualizar);
    document.addEventListener("focusout", alSalir);
    return () => {
      document.removeEventListener("focusin", actualizar);
      document.removeEventListener("focusout", alSalir);
    };
  }, []);
  return escribiendo;
}

const TABS: { id: Tab; clave: "tab.search" | "tab.history" | "tab.dicts" | "tab.settings" }[] = [
  { id: "search", clave: "tab.search" },
  { id: "history", clave: "tab.history" },
  { id: "dicts", clave: "tab.dicts" },
  { id: "settings", clave: "tab.settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("search");
  const escribiendo = useEscribiendoEnMovil();
  // ?q=食べる abre la app con esa búsqueda (enlaces, marcadores, atajos desde el navegador).
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  // Estables entre renders: las fichas de resultados van memorizadas y dependen de ellas.
  const setSettings = useCallback((s: Settings) => { setSettingsState(s); saveSettings(s); }, []);

  const idioma = settings.idioma === "auto" ? idiomaDelSistema() : settings.idioma;
  const t = useMemo(() => crearT(idioma), [idioma]);

  // Copia de seguridad diaria al servidor: al abrir la app y al volver a ella (en iOS una PWA casi
  // nunca se cierra del todo, así que solo al arrancar se quedaría días sin hacerse).
  useEffect(() => {
    copiaAutomaticaSiToca(settings);
    const alVolver = () => { if (document.visibilityState === "visible") copiaAutomaticaSiToca(settings); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [settings]);
  const locale = localeDe(idioma);

  const buscarDesdeHistorial = (q: string) => { setQuery(q); setTab("search"); };

  return (
    <div className="app">
      <main className="view">
        <SyncBanner settings={settings} t={t} />
        {/* SearchView se mantiene montado para no perder la búsqueda al cambiar de pestaña */}
        <div hidden={tab !== "search"}>
          <SearchView
            query={query}
            setQuery={setQuery}
            settings={settings}
            setSettings={setSettings}
            onOpenDicts={() => setTab("dicts")}
            t={t}
            idioma={idioma}
          />
        </div>
        {tab === "history" && <HistoryView onSearch={buscarDesdeHistorial} t={t} locale={locale} />}
        {tab === "dicts" && <DictionariesView t={t} locale={locale} />}
        {tab === "settings" && <SettingsView settings={settings} setSettings={setSettings} t={t} />}
      </main>
      <nav className="tabs" aria-label="Secciones" hidden={escribiendo}>
        {TABS.map(pestana => (
          <button
            key={pestana.id}
            className="tab"
            aria-current={tab === pestana.id ? "page" : undefined}
            onClick={() => setTab(pestana.id)}
          >
            {t(pestana.clave)}
          </button>
        ))}
      </nav>
    </div>
  );
}
