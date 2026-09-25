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

  async function borrar() {
    if (confirm(t("history.confirmClear"))) await clearHistory();
  }

  if (items && items.length === 0) {
    return (
      <div className="page">
        <h1>{t("history.title")}</h1>
        <p className="empty">{t("history.empty")}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{t("history.title")}</h1>
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
