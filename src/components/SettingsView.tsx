import { useState } from "react";
import type { AnkiMode, Settings } from "../settings";
import { IDIOMAS, type Idioma, type T } from "../i18n";
import { ensureNotetype, health, listDecks, sync } from "../server";

interface Props { settings: Settings; setSettings: (s: Settings) => void; t: T }

type Feedback = { ok: boolean; text: string } | null;

export function SettingsView({ settings, setSettings, t }: Props) {
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
    return t("settings.connected", {
      noteType: h.notetype,
      audio: h.audio ? t("settings.audioOn") : t("settings.audioOff"),
      sync: h.sync ? t("settings.syncOn") : t("settings.syncOff"),
    });
  }, t("settings.connecting"));

  const cargarMazos = () => run(async () => {
    const { decks } = await listDecks(settings);
    if (!decks.length) return t("settings.noDecks");
    setSettings({
      ...settings,
      decks,
      lastDeck: decks.includes(settings.lastDeck) ? settings.lastDeck : decks[0],
    });
    return decks.length === 1
      ? t("settings.decksLoadedOne")
      : t("settings.decksLoadedMany", { count: decks.length });
  }, t("settings.loadingDecks"));

  const crearTipoDeNota = () => run(async () => {
    const r = await ensureNotetype(settings);
    const base = r.created ? t("settings.noteTypeCreated") : t("settings.noteTypeUpdated");
    return r.warnings.length ? `${base} ${r.warnings.join(" ")}` : base;
  }, t("settings.creatingNoteType"));

  const sincronizar = () => run(async () => {
    const r = await sync(settings);
    // La media sigue subiendo de fondo: se avisa para que no parezca que falta algo.
    return t("settings.synced", { state: r.required }) + (r.server_message ? ` ${r.server_message}` : "");
  }, t("settings.syncing"));

  return (
    <div className="page">
      <h1>{t("settings.title")}</h1>

      <section className="settings-group">
        <h2>{t("settings.decks")}</h2>
        <p className="hint">{t("settings.decksHint")}</p>
        <ul className="deck-list">
          {settings.decks.map(d => (
            <li key={d}>
              <span>{d}</span>
              <button className="text danger" onClick={() => update("decks", settings.decks.filter(x => x !== d))}>{t("settings.removeDeck")}</button>
            </li>
          ))}
        </ul>
        <div className="inline-form">
          <input value={newDeck} onChange={e => setNewDeck(e.target.value)} placeholder={t("settings.deckName")} onKeyDown={e => e.key === "Enter" && addDeck()} />
          <button onClick={addDeck}>{t("settings.addDeck")}</button>
        </div>
      </section>

      <section className="settings-group">
        <h2>{t("settings.howToAdd")}</h2>
        <label className="field">
          <span>{t("settings.mode")}</span>
          <select value={settings.mode} onChange={e => update("mode", e.target.value as AnkiMode)}>
            <option value="ankimobile">{t("settings.modeAnkimobile")}</option>
            <option value="server">{t("settings.modeServer")}</option>
          </select>
        </label>

        {settings.mode === "ankimobile" ? (
          <>
            <label className="field">
              <span>{t("settings.noteType")}</span>
              <input value={settings.noteType} onChange={e => update("noteType", e.target.value)} />
            </label>
            <label className="field">
              <span>{t("settings.profile")}</span>
              <input value={settings.profile} onChange={e => update("profile", e.target.value)} placeholder={t("settings.profilePlaceholder")} />
            </label>
            <p className="hint">
              {t("settings.ankimobileHint", { noteType: settings.noteType })}
            </p>
          </>
        ) : (
          <>
            <label className="field">
              <span>{t("settings.serverUrl")}</span>
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
              <span>{t("settings.token")}</span>
              <input
                value={settings.serverToken}
                onChange={e => update("serverToken", e.target.value)}
                type="password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("settings.tokenPlaceholder")}
              />
            </label>
            <div className="button-row">
              <button onClick={probar} disabled={busy}>{t("settings.test")}</button>
              <button onClick={cargarMazos} disabled={busy}>{t("settings.loadDecks")}</button>
              <button onClick={crearTipoDeNota} disabled={busy}>{t("settings.createNoteType")}</button>
              <button onClick={sincronizar} disabled={busy}>{t("settings.sync")}</button>
            </div>
            {feedback && <p className={feedback.ok ? "hint" : "error"}>{feedback.text}</p>}
            <p className="hint">
              {t("settings.serverHint")}
            </p>
          </>
        )}
      </section>

      <section className="settings-group">
        <h2>{t("settings.language")}</h2>
        <label className="field">
          <select
            value={settings.idioma}
            onChange={e => update("idioma", e.target.value as Idioma | "auto")}
            aria-label={t("settings.language")}
          >
            <option value="auto">{t("settings.languageAuto")}</option>
            {IDIOMAS.map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
          </select>
        </label>
      </section>

      <section className="settings-group">
        <h2>{t("settings.tags")}</h2>
        <label className="field">
          <span>{t("settings.tagsHint")}</span>
          <input value={settings.tags} onChange={e => update("tags", e.target.value)} />
        </label>
      </section>
    </div>
  );
}
