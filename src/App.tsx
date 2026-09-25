import { useState } from "react";
import { SearchView } from "./components/SearchView";
import { HistoryView } from "./components/HistoryView";
import { DictionariesView } from "./components/DictionariesView";
import { SettingsView } from "./components/SettingsView";
import { SyncBanner } from "./components/SyncBanner";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { crearT, idiomaDelSistema, localeDe } from "./i18n";

type Tab = "search" | "history" | "dicts" | "settings";

const TABS: { id: Tab; clave: "tab.search" | "tab.history" | "tab.dicts" | "tab.settings" }[] = [
  { id: "search", clave: "tab.search" },
  { id: "history", clave: "tab.history" },
  { id: "dicts", clave: "tab.dicts" },
  { id: "settings", clave: "tab.settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const setSettings = (s: Settings) => { setSettingsState(s); saveSettings(s); };

  const idioma = settings.idioma === "auto" ? idiomaDelSistema() : settings.idioma;
  const t = crearT(idioma);
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
      <nav className="tabs" aria-label="Secciones">
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
