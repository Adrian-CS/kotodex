import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { clearHistory } from "../history";

interface Props { onSearch: (query: string) => void }

const HOY = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const OTRO_DIA = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });

function cuando(at: number): string {
  const fecha = new Date(at);
  const hoy = new Date();
  const mismoDia = fecha.toDateString() === hoy.toDateString();
  return mismoDia ? HOY.format(fecha) : OTRO_DIA.format(fecha);
}

export function HistoryView({ onSearch }: Props) {
  const items = useLiveQuery(() => db.lookups.orderBy("at").reverse().limit(200).toArray(), []);
  const added = useLiveQuery(() => db.added.toArray(), []);
  const enAnki = new Set((added ?? []).map(a => a.key));

  async function borrar() {
    if (confirm("¿Borrar todo el historial?")) await clearHistory();
  }

  if (items && items.length === 0) {
    return (
      <div className="page">
        <h1>Historial</h1>
        <p className="empty">Aquí se van guardando las palabras que buscas.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Historial</h1>
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
                  <span className="history-query" lang="ja">buscaste {s.query}</span>
                )}
                <span className="history-when">{cuando(s.at)}</span>
                {añadida && <span className="history-added" title="Añadida a Anki">Anki</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {items && items.length > 0 && (
        <button className="text danger" onClick={borrar}>Borrar historial</button>
      )}
    </div>
  );
}
