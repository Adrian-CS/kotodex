import { useState } from "react";
import type { AnkiMode, Settings } from "../settings";
import { ensureNotetype, health, listDecks, sync } from "../server";

interface Props { settings: Settings; setSettings: (s: Settings) => void }

type Feedback = { ok: boolean; text: string } | null;

export function SettingsView({ settings, setSettings }: Props) {
  const [newDeck, setNewDeck] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });

  function addDeck() {
    const name = newDeck.trim();
    if (!name || settings.decks.includes(name)) return;
    setSettings({ ...settings, decks: [...settings.decks, name], lastDeck: settings.decks.length ? settings.lastDeck : name });
    setNewDeck("");
  }

  /**
   * Lanza una acción contra el servidor y enseña el resultado, sea bueno o malo.
   * `enCurso` se enseña mientras tanto: sin eso, sincronizar parecía no hacer nada.
   */
  async function run(action: () => Promise<string>, enCurso: string) {
    setBusy(true);
    setFeedback({ ok: true, text: enCurso });
    try {
      setFeedback({ ok: true, text: await action() });
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const probar = () => run(async () => {
    const h = await health(settings);
    return `Conectado. Tipo de nota «${h.notetype}», audio ${h.audio ? "configurado" : "sin configurar"}, ` +
      `sync con AnkiWeb ${h.sync ? "disponible" : "sin credenciales"}.`;
  }, "Conectando…");

  const cargarMazos = () => run(async () => {
    const { decks } = await listDecks(settings);
    if (!decks.length) return "El servidor no tiene mazos todavía.";
    setSettings({
      ...settings,
      decks,
      lastDeck: decks.includes(settings.lastDeck) ? settings.lastDeck : decks[0],
    });
    return `${decks.length} ${decks.length === 1 ? "mazo cargado" : "mazos cargados"} desde el servidor.`;
  }, "Cargando mazos…");

  const crearTipoDeNota = () => run(async () => {
    const r = await ensureNotetype(settings);
    const base = r.created ? "Tipo de nota creado." : "Tipo de nota actualizado (plantillas y CSS).";
    return r.warnings.length ? `${base} ${r.warnings.join(" ")}` : base;
  }, "Creando el tipo de nota…");

  const sincronizar = () => run(async () => {
    const r = await sync(settings);
    // La media sigue subiendo de fondo: se avisa para que no parezca que falta algo.
    return `Sincronizado (${r.required}). La media sigue subiendo en segundo plano.` +
      `${r.server_message ? ` ${r.server_message}` : ""}`;
  }, "Sincronizando con AnkiWeb…");

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
        <h2>Cómo se añaden las tarjetas</h2>
        <label className="field">
          <span>Modo</span>
          <select value={settings.mode} onChange={e => update("mode", e.target.value as AnkiMode)}>
            <option value="ankimobile">AnkiMobile (abre la app)</option>
            <option value="server">Servidor propio (con audio)</option>
          </select>
        </label>

        {settings.mode === "ankimobile" ? (
          <>
            <label className="field">
              <span>Tipo de nota</span>
              <input value={settings.noteType} onChange={e => update("noteType", e.target.value)} />
            </label>
            <label className="field">
              <span>Perfil de AnkiMobile (opcional)</span>
              <input value={settings.profile} onChange={e => update("profile", e.target.value)} placeholder="Perfil actual" />
            </label>
            <p className="hint">
              «Añadir a Anki» abre AnkiMobile con la nota rellenada. El tipo de nota «{settings.noteType}» tiene que
              existir ya con los campos Expression, Reading, Audio, Pitch, PitchNum, DefJA, DefES y DefEN.
            </p>
          </>
        ) : (
          <>
            <label className="field">
              <span>Dirección del servidor</span>
              <input
                value={settings.serverUrl}
                onChange={e => update("serverUrl", e.target.value)}
                placeholder="https://anki.tudominio.com"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Token</span>
              <input
                value={settings.serverToken}
                onChange={e => update("serverToken", e.target.value)}
                type="password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="El KOTODEX_TOKEN del servidor"
              />
            </label>
            <div className="button-row">
              <button onClick={probar} disabled={busy}>Probar conexión</button>
              <button onClick={cargarMazos} disabled={busy}>Cargar mazos</button>
              <button onClick={crearTipoDeNota} disabled={busy}>Crear tipo de nota</button>
              <button onClick={sincronizar} disabled={busy}>Sincronizar</button>
            </div>
            {feedback && <p className={feedback.ok ? "hint" : "error"}>{feedback.text}</p>}
            <p className="hint">
              El token se guarda en este dispositivo. «Crear tipo de nota» hay que pulsarlo una vez, antes de
              añadir la primera tarjeta.
            </p>
          </>
        )}
      </section>

      <section className="settings-group">
        <h2>Etiquetas</h2>
        <label className="field">
          <span>Separadas por espacios</span>
          <input value={settings.tags} onChange={e => update("tags", e.target.value)} />
        </label>
      </section>
    </div>
  );
}
