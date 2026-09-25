import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, entryKey } from "../db";
import { recordSearch } from "../history";
import { search, type Entry } from "../search";
import { checkNotes, type WordCheck } from "../server";
import type { Settings } from "../settings";
import { EntryCard } from "./EntryCard";

/** Diccionarios que han aportado definiciones, en el orden en que salen (o sea, por prioridad). */
function diccionariosDe(entradas: Entry[]): string[] {
  const salida: string[] = [];
  for (const e of entradas) {
    for (const role of e.sections) {
      for (const b of e.defs[role]) if (!salida.includes(b.dictTitle)) salida.push(b.dictTitle);
    }
  }
  return salida;
}

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
  const [dupes, setDupes] = useState<Map<string, WordCheck>>(new Map());
  const [filtro, setFiltro] = useState<string | null>(null);
  // La lista de filtros se calcula con la búsqueda SIN filtrar y se conserva mientras hay uno
  // puesto: si no, al filtrar desaparecerían los demás botones y no habría forma de cambiar.
  const [chips, setChips] = useState<string[]>([]);
  // Huella de los diccionarios: cambia al importar, borrar, reordenar, cambiar el rol o activar
  // y desactivar. Se usa como dependencia para que los resultados en pantalla no se queden viejos.
  const dictHuella = useLiveQuery(
    async () => (await db.dictionaries.toArray())
      .map(d => `${d.id}:${d.enabled ? 1 : 0}:${d.role}:${d.order ?? d.id}`)
      .join("|"),
    [],
  );
  const dictCount = dictHuella === undefined ? undefined : (dictHuella ? dictHuella.split("|").length : 0);
  const requestId = useRef(0);

  // Una consulta nueva empieza siempre sin filtro.
  useEffect(() => { setFiltro(null); }, [query]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setChips([]); return; }
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      search(q, filtro)
        .then(r => {
          if (id !== requestId.current) return;
          setResults(r);
          setError(null);
          if (filtro === null) {
            setChips(diccionariosDe(r));
            recordSearch(q, r);   // el historial guarda la búsqueda completa, no la filtrada
          }
        })
        .catch(e => { if (id === requestId.current) setError(String(e?.message ?? e)); });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, filtro, dictHuella]);

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
        setDupes(new Map(r.results.map(x => [entryKey(x.expression, x.reading), x])));
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

      {chips.length > 1 && (
        <div className="filtros" role="group" aria-label="Filtrar por diccionario">
          <button className={`chip${filtro === null ? " activo" : ""}`} onClick={() => setFiltro(null)}>
            Todos
          </button>
          {chips.map(nombre => (
            <button
              key={nombre}
              className={`chip${filtro === nombre ? " activo" : ""}`}
              aria-pressed={filtro === nombre}
              onClick={() => setFiltro(filtro === nombre ? null : nombre)}
            >
              {nombre}
            </button>
          ))}
        </div>
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
