import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { clearHistory } from "../history";
import { anadirVarias, type ResultadoVarias } from "../anadirVarias";
import type { Settings } from "../settings";
import type { T } from "../i18n";

interface Props {
  onSearch: (query: string) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  t: T;
  locale: string;
}

function cuando(at: number, locale: string): string {
  const fecha = new Date(at);
  const mismoDia = fecha.toDateString() === new Date().toDateString();
  const formato = mismoDia
    ? { hour: "2-digit" as const, minute: "2-digit" as const }
    : { day: "numeric" as const, month: "short" as const };
  return new Intl.DateTimeFormat(locale, formato).format(fecha);
}

export function HistoryView({ onSearch, settings, setSettings, t, locale }: Props) {
  const items = useLiveQuery(() => db.lookups.orderBy("at").reverse().limit(200).toArray(), []);
  const added = useLiveQuery(() => db.added.toArray(), []);
  const enAnki = new Set((added ?? []).map(a => a.key));
  // «Añadidas»: lo que se ha mandado a Anki desde aquí, lo último primero. La clave es
  // expresión + \u0000 + lectura (entryKey), así que se parte para enseñarla.
  const [vista, setVista] = useState<"buscadas" | "añadidas">("buscadas");
  const añadidas = [...(added ?? [])].sort((a, b) => b.at - a.at).map(a => {
    const [expression, reading = expression] = a.key.split("\u0000");
    return { ...a, expression, reading };
  });

  // Añadir varias de golpe (solo con servidor: con AnkiMobile cada tarjeta sale de la app).
  const conServidor = settings.mode === "server" && !!settings.serverUrl && !!settings.serverToken;
  const [seleccion, setSeleccion] = useState<Set<string> | null>(null);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoVarias | null>(null);
  const deck = settings.decks.includes(settings.lastDeck) ? settings.lastDeck : settings.decks[0] ?? "";
  const alternar = (key: string) => setSeleccion(s => {
    const nueva = new Set(s);
    if (nueva.has(key)) nueva.delete(key); else nueva.add(key);
    return nueva;
  });
  const empezarSeleccion = () => { setResultado(null); setSeleccion(new Set()); };

  async function anadirSeleccion() {
    if (!seleccion?.size || !items) return;
    // En el orden de la lista (lo más reciente primero), no en el de los toques.
    const elegidas = items.filter(i => seleccion.has(i.key));
    setProgreso({ hechas: 0, total: elegidas.length });
    const r = await anadirVarias(elegidas, settings, deck, hechas => setProgreso({ hechas, total: elegidas.length }));
    setProgreso(null);
    setSeleccion(null);
    setResultado(r);
  }

  async function borrar() {
    if (confirm(t("history.confirmClear"))) await clearHistory();
  }

  const pestañas = (
    <div className="filtros" role="tablist">
      <button role="tab" aria-selected={vista === "buscadas"} className={`chip${vista === "buscadas" ? " activo" : ""}`}
        onClick={() => setVista("buscadas")}>{t("history.searchedTab")}</button>
      <button role="tab" aria-selected={vista === "añadidas"} className={`chip${vista === "añadidas" ? " activo" : ""}`}
        onClick={() => setVista("añadidas")}>{t("history.addedTab", { count: añadidas.length })}</button>
    </div>
  );

  if (vista === "añadidas") {
    return (
      <div className="page">
        <h1>{t("history.title")}</h1>
        {pestañas}
        {añadidas.length === 0 && <p className="empty">{t("history.addedEmpty")}</p>}
        <ul className="history-list">
          {añadidas.map(a => (
            <li key={a.key}>
              <button className="history-item" onClick={() => onSearch(a.expression)}>
                <span className="history-word" lang="ja">{a.expression}</span>
                {a.reading !== a.expression && <span className="history-reading" lang="ja">{a.reading}</span>}
                <span className="history-query">{a.deck}</span>
                <span className="history-when">{cuando(a.at, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (items && items.length === 0) {
    return (
      <div className="page">
        <h1>{t("history.title")}</h1>
        {pestañas}
        <p className="empty">{t("history.empty")}</p>
      </div>
    );
  }

  const seleccionando = seleccion !== null;
  const noAñadidas = (items ?? []).filter(i => !enAnki.has(i.key));

  return (
    <div className="page">
      <h1>{t("history.title")}</h1>
      {pestañas}

      {conServidor && !seleccionando && !progreso && items && items.length > 0 && (
        <div className="varias-barra">
          <button className="text" onClick={empezarSeleccion}>{t("batch.select")}</button>
        </div>
      )}
      {seleccionando && !progreso && (
        <div className="varias-panel">
          <div className="varias-fila">
            <span>{t("batch.selected", { count: seleccion.size })}</span>
            <button className="text" onClick={() => setSeleccion(new Set(noAñadidas.map(i => i.key)))} disabled={!noAñadidas.length}>
              {t("batch.allNew", { count: noAñadidas.length })}
            </button>
          </div>
          <div className="entry-actions">
            <select value={deck} onChange={e => setSettings({ ...settings, lastDeck: e.target.value })} aria-label={t("entry.deck")}>
              {settings.decks.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button className="primary" onClick={anadirSeleccion} disabled={!seleccion.size || !deck}>
              {t("batch.add", { count: seleccion.size })}
            </button>
          </div>
          <button className="text" onClick={() => setSeleccion(null)}>{t("batch.cancel")}</button>
        </div>
      )}
      {progreso && (
        <div className="varias-panel" role="status">
          <div>{t("batch.adding", { done: Math.min(progreso.hechas + 1, progreso.total), total: progreso.total })}</div>
          <progress value={progreso.hechas} max={progreso.total} />
        </div>
      )}
      {resultado && (
        <div className="varias-panel" role="status">
          <p className="hint">
            {t("batch.done", { added: resultado.añadidas, dupes: resultado.yaEstaban })}
            {resultado.syncEnSegundos != null && t("entry.syncIn", {
              when: resultado.syncEnSegundos < 90 ? `${resultado.syncEnSegundos} s` : `${Math.round(resultado.syncEnSegundos / 60)} min`,
            })}
          </p>
          {resultado.fallos.map(f => (
            <p key={f.palabra} className="error"><span lang="ja">{f.palabra}</span>: {f.motivo}</p>
          ))}
        </div>
      )}

      <ul className="history-list">
        {items?.map(s => {
          const añadida = enAnki.has(s.key);
          const marcada = seleccion?.has(s.key) ?? false;
          return (
            <li key={s.key}>
              <button
                className={`history-item${marcada ? " marcada" : ""}`}
                onClick={() => (seleccionando ? alternar(s.key) : onSearch(s.query))}
                aria-pressed={seleccionando ? marcada : undefined}
              >
                {seleccionando && <span className="casilla" aria-hidden="true">{marcada ? "✓" : ""}</span>}
                <span className="history-word" lang="ja">{s.expression}</span>
                {s.reading !== s.expression && (
                  <span className="history-reading" lang="ja">{s.reading}</span>
                )}
                {s.query !== s.expression && (
                  <span className="history-query" lang="ja">{t("history.searched", { query: s.query })}</span>
                )}
                <span className="history-when">{cuando(s.at, locale)}</span>
                {añadida && <span className="history-added" title={t("history.inAnkiTitle")}>{t("history.inAnki")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {items && items.length > 0 && !seleccionando && (
        <button className="text danger" onClick={borrar}>{t("history.clear")}</button>
      )}
    </div>
  );
}
