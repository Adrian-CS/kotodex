import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { search, type Entry } from "../search";
import type { Settings } from "../settings";
import { EntryCard } from "./EntryCard";

interface Props { settings: Settings; setSettings: (s: Settings) => void; onOpenDicts: () => void }

export function SearchView({ settings, setSettings, onOpenDicts }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dictCount = useLiveQuery(() => db.dictionaries.count(), []);
  const requestId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      search(q)
        .then(r => { if (id === requestId.current) { setResults(r); setError(null); } })
        .catch(e => { if (id === requestId.current) setError(String(e?.message ?? e)); });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, dictCount]);

  return (
    <div className="search">
      <div className="search-bar">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="単語を検索"
          aria-label="Buscar palabra"
          lang="ja"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {dictCount === 0 && (
        <div className="empty">
          <p>Todavía no hay diccionarios. Importa los .zip de Yomitan que uses (JMdict, un monolingüe, pitch…).</p>
          <button className="primary" onClick={onOpenDicts}>Importar diccionarios</button>
        </div>
      )}

      {error && <p className="error">No se pudo buscar: {error}</p>}

      {results && results.length === 0 && dictCount !== 0 && (
        <p className="empty">Sin resultados para «{query.trim()}». Prueba con la forma de diccionario o revisa qué diccionarios tienes activos.</p>
      )}

      {results?.map(e => (
        <EntryCard key={`${e.expression}|${e.reading}`} entry={e} settings={settings} setSettings={setSettings} />
      ))}
    </div>
  );
}
