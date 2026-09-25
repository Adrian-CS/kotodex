import { useState } from "react";
import { SearchView } from "./components/SearchView";
import { DictionariesView } from "./components/DictionariesView";
import { SettingsView } from "./components/SettingsView";
import { loadSettings, saveSettings, type Settings } from "./settings";

type Tab = "search" | "dicts" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Buscar" },
  { id: "dicts", label: "Diccionarios" },
  { id: "settings", label: "Ajustes" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("search");
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const setSettings = (s: Settings) => { setSettingsState(s); saveSettings(s); };

  return (
    <div className="app">
      <main className="view">
        {/* SearchView se mantiene montado para no perder la búsqueda al cambiar de pestaña */}
        <div hidden={tab !== "search"}>
          <SearchView settings={settings} setSettings={setSettings} onOpenDicts={() => setTab("dicts")} />
        </div>
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
