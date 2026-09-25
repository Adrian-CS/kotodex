import { useState } from "react";
import { SearchView } from "./components/SearchView";
import { HistoryView } from "./components/HistoryView";
import { DictionariesView } from "./components/DictionariesView";
import { SettingsView } from "./components/SettingsView";
import { SyncBanner } from "./components/SyncBanner";
import { loadSettings, saveSettings, type Settings } from "./settings";

type Tab = "search" | "history" | "dicts" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Buscar" },
  { id: "history", label: "Historial" },
  { id: "dicts", label: "Diccionarios" },
  { id: "settings", label: "Ajustes" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const setSettings = (s: Settings) => { setSettingsState(s); saveSettings(s); };

  const buscarDesdeHistorial = (q: string) => { setQuery(q); setTab("search"); };

  return (
    <div className="app">
      <main className="view">
        <SyncBanner settings={settings} />
        {/* SearchView se mantiene montado para no perder la búsqueda al cambiar de pestaña */}
        <div hidden={tab !== "search"}>
          <SearchView
            query={query}
            setQuery={setQuery}
            settings={settings}
            setSettings={setSettings}
            onOpenDicts={() => setTab("dicts")}
          />
        </div>
        {tab === "history" && <HistoryView onSearch={buscarDesdeHistorial} />}
        {tab === "dicts" && <DictionariesView />}
        {tab === "settings" && <SettingsView settings={settings} setSettings={setSettings} />}
      </main>
      <nav className="tabs" aria-label="Secciones">
        {TABS.map(t => (
          <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
