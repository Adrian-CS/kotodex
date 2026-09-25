import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, entryKey } from "../db";
import { recordSearch } from "../history";
import { search, type Entry } from "../search";
import { checkNotes } from "../server";
import type { Settings } from "../settings";
import { EntryCard } from "./EntryCard";

interface Props {
  query: string;
  setQuery: (q: string) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onOpenDicts: () => void;
}

export function SearchView({ query, setQuery, settings, setSettings, onOpenDicts }: Props) {
  const [results, setResults] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<Map<string, number>>(new Map());
  const dictCount = useLiveQuery(() => db.dictionaries.count(), []);
  const requestId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      search(q)
        .then(r => {
          if (id !== requestId.current) return;
          setResults(r);
          setError(null);
          recordSearch(q, r);
        })
        .catch(e => { if (id === requestId.current) setError(String(e?.message ?? e)); });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, dictCount]);

  // Comprobar qué palabras ya están en la colección. Va aparte de la búsqueda porque sale a la
  // red y tarda (~60 ms por palabra): los resultados se enseñan ya y las marcas llegan después.
  useEffect(() => {
    setDupes(new Map());
    const listo = settings.mode === "server" && settings.serverUrl && settings.serverToken;
    if (!listo || !results?.length) return;
    let cancelado = false;
    checkNotes(settings, results.map(e => ({ expression: e.expression, reading: e.reading })))
      .then(r => {
        if (cancelado) return;
        setDupes(new Map(r.results.map(x => [entryKey(x.expression, x.reading), x.notes])));
      })
      .catch(() => { /* sin servidor no se marca nada, y ya está */ });
    return () => { cancelado = true; };
  }, [results, settings.mode, settings.serverUrl, settings.serverToken]);

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
        <EntryCard
          key={`${e.expression}|${e.reading}`}
          entry={e}
          settings={settings}
          setSettings={setSettings}
          inCollection={dupes.get(entryKey(e.expression, e.reading))}
        />
      ))}
    </div>
  );
}
