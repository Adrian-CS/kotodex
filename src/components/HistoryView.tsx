import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { clearHistory } from "../history";
import type { T } from "../i18n";

interface Props { onSearch: (query: string) => void; t: T; locale: string }

function cuando(at: number, locale: string): string {
  const fecha = new Date(at);
  const mismoDia = fecha.toDateString() === new Date().toDateString();
  const formato = mismoDia
    ? { hour: "2-digit" as const, minute: "2-digit" as const }
    : { day: "numeric" as const, month: "short" as const };
  return new Intl.DateTimeFormat(locale, formato).format(fecha);
}

export function HistoryView({ onSearch, t, locale }: Props) {
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

  return (
    <div className="page">
      <h1>{t("history.title")}</h1>
      {pestañas}
      <ul className="history-list">
        {items?.map(s => {
          const añadida = enAnki.has(s.key);
          return (
            <li key={s.key}>
              <button className="history-item" onClick={() => onSearch(s.query)}>
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
      {items && items.length > 0 && (
        <button className="text danger" onClick={borrar}>{t("history.clear")}</button>
      )}
    </div>
  );
}
