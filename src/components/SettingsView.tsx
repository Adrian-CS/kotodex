import { useState } from "react";
import type { Settings } from "../settings";

interface Props { settings: Settings; setSettings: (s: Settings) => void }

export function SettingsView({ settings, setSettings }: Props) {
  const [newDeck, setNewDeck] = useState("");
  const update = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });

  function addDeck() {
    const name = newDeck.trim();
    if (!name || settings.decks.includes(name)) return;
    setSettings({ ...settings, decks: [...settings.decks, name], lastDeck: settings.decks.length ? settings.lastDeck : name });
    setNewDeck("");
  }

  return (
    <div className="page">
      <h1>Ajustes</h1>

      <section className="settings-group">
        <h2>Mazos</h2>
        <p className="hint">Escribe el nombre exacto del mazo en Anki. Para un submazo usa <code>Padre::Hijo</code>.</p>
        <ul className="deck-list">
          {settings.decks.map(d => (
            <li key={d}>
              <span>{d}</span>
              <button className="text danger" onClick={() => update("decks", settings.decks.filter(x => x !== d))}>Quitar</button>
            </li>
          ))}
        </ul>
        <div className="inline-form">
          <input value={newDeck} onChange={e => setNewDeck(e.target.value)} placeholder="Nombre del mazo" onKeyDown={e => e.key === "Enter" && addDeck()} />
          <button onClick={addDeck}>Añadir mazo</button>
        </div>
      </section>

      <section className="settings-group">
        <h2>Anki</h2>
        <label className="field">
          <span>Tipo de nota</span>
          <input value={settings.noteType} onChange={e => update("noteType", e.target.value)} />
        </label>
        <label className="field">
          <span>Perfil de AnkiMobile (opcional)</span>
          <input value={settings.profile} onChange={e => update("profile", e.target.value)} placeholder="Perfil actual" />
        </label>
        <label className="field">
          <span>Etiquetas</span>
          <input value={settings.tags} onChange={e => update("tags", e.target.value)} />
        </label>
        <p className="hint">
          Ahora mismo «Añadir a Anki» abre AnkiMobile con la nota rellenada. El tipo de nota «{settings.noteType}» tiene que existir ya en
          AnkiMobile con los campos Expression, Reading, Audio, Pitch, PitchNum, DefJA, DefES y DefEN.
        </p>
      </section>
    </div>
  );
}
