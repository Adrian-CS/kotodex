import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, entryKey } from "../db";
import { recordSearch } from "../history";
import { BusquedaCancelada, search, type Entry, type Tiempos } from "../search";
import { esConsultaLatina } from "../glosses";
import { checkNotes, type WordCheck } from "../server";
import type { Settings } from "../settings";
import type { Idioma, T } from "../i18n";
import { EntryCard } from "./EntryCard";
import { KanjiSheet } from "./KanjiSheet";
import { RadicalPicker } from "./RadicalPicker";
import { DibujoKanji } from "./DibujoKanji";
import { porcentaje, useImportacion } from "../importaciones";
import { esFrase, palabraEn, soloFrase, trozo } from "../frase";
import { fraseHtml } from "../anki";
import { hayDiccionarioKanji } from "../kanji";

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

/** Lo que se pega como mucho: una frase larga cabe; un capítulo entero, no. */
const MAX_PEGADO = 300;

/** A partir de cuánto se enseña el desglose de tiempos debajo de la barra. */
const UMBRAL_LENTA_MS = 1500;
const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

interface Props {
  query: string;
  setQuery: (q: string) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onOpenDicts: () => void;
  t: T;
  idioma: Idioma;
}

export function SearchView({ query, setQuery, settings, setSettings, onOpenDicts, t, idioma }: Props) {
  const [results, setResults] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<Map<string, WordCheck>>(new Map());
  const [filtro, setFiltro] = useState<string | null>(null);
  // Hay una búsqueda pendiente (en espera o en curso). La barra solo se ve si tarda: ver .cargando.
  const [buscando, setBuscando] = useState(false);
  // Desglose de la última búsqueda si fue lenta: sirve para saber qué fase falla en el iPhone.
  const [lenta, setLenta] = useState<Tiempos | null>(null);
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
  // Fichas de kanji abiertas, como una pila: tocar un componente (懐 → 心) apila y «volver» desapila.
  // Solo se ofrecen si hay algún diccionario de kanji activo.
  const [pilaKanji, setPilaKanji] = useState<string[]>([]);
  const abrirKanji = useCallback((k: string) => setPilaKanji([k]), []);
  const kanji = pilaKanji.at(-1) ?? null;
  const [radicalesAbierto, setRadicalesAbierto] = useState(false);
  const [dibujoAbierto, setDibujoAbierto] = useState(false);
  const [errorPegar, setErrorPegar] = useState(false);
  // Si hay una importación en marcha (en su worker), se avisa aquí: se puede seguir buscando.
  const { progreso: importando } = useImportacion();

  /**
   * Lee el portapapeles y lo busca. En iOS, readText() enseña la burbuja «Pegar» del sistema y
   * espera a que se toque: ninguna web lee el portapapeles sin que el usuario lo confirme. Si no
   * hay permiso o API, se dice cómo pegar a mano en vez de fallar en silencio.
   */
  const pegarYBuscar = async () => {
    setErrorPegar(false);
    try {
      // Una frase entera no encontraría nada: primera línea, espacios recogidos y un tope.
      const texto = (await navigator.clipboard.readText()).split(/\r?\n/).find(l => l.trim()) ?? "";
      const limpio = texto.replace(/\s+/g, " ").trim().slice(0, MAX_PEGADO);
      if (limpio) setQuery(limpio);
      else setErrorPegar(true);
    } catch {
      setErrorPegar(true);
    }
  };
  const conKanji = useLiveQuery(() => hayDiccionarioKanji(), [dictHuella]);

  // Qué fichas ya se añadieron, en UNA consulta para todas. Antes cada ficha tenía la suya, y eran
  // veinte consultas en vivo a IndexedDB cada vez que llegaban resultados nuevos.
  const claves = results?.map(e => entryKey(e.expression, e.reading)) ?? [];
  const anadidas = useLiveQuery(
    async () => new Map((await db.added.bulkGet(claves)).filter(a => a !== undefined).map(a => [a.key, a])),
    [claves.join("|")],
  );

  // Una consulta nueva empieza siempre sin filtro.
  // Frase: la palabra tocada (posiciones en caracteres). Se busca ese trozo en vez de la frase entera.
  const [foco, setFoco] = useState<{ inicio: number; largo: number } | null>(null);
  const [sinPalabra, setSinPalabra] = useState(false);
  useEffect(() => { setFoco(null); setSinPalabra(false); }, [query]);
  const consulta = foco ? trozo(query, foco.inicio, foco.largo) : query;
  // Una frase larga o con puntuación no se busca entera: no daría nada útil. Se espera al toque.
  const esperandoToque = !foco && soloFrase(query);
  // Para la tarjeta: la frase con la palabra tocada en negrita. Una cadena, para no romper el memo de las fichas.
  const frase = useMemo(
    () => (foco && esFrase(query) ? fraseHtml(query, foco.inicio, foco.largo) : undefined),
    [query, foco],
  );

  async function tocarFrase(e: React.MouseEvent<HTMLElement>) {
    const i = Number((e.target as HTMLElement).dataset.i);
    if (!Number.isInteger(i)) return;
    const largo = await palabraEn(query, i);
    setSinPalabra(largo === 0);
    if (largo) {
      setFoco({ inicio: i, largo });
      // Si se tocó estando abajo en una ficha larga, la nueva empieza arriba: se vuelve a ella.
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  useEffect(() => { setFiltro(null); }, [consulta]);

  useEffect(() => {
    const q = esperandoToque ? "" : consulta.trim();
    if (!q) { setResults(null); setChips([]); setBuscando(false); return; }
    const id = ++requestId.current;
    setBuscando(true);
    // En alfabeto latino se teclea letra a letra (en japonés el IME entrega la palabra entera), así
    // que se espera algo más antes de buscar: cada pausa breve lanzaba una búsqueda intermedia.
    const espera = esConsultaLatina(q) ? 350 : 200;
    const timer = setTimeout(() => {
      search(q, filtro, {
        vigente: () => id === requestId.current,
        alMedir: t => setLenta(t.total > UMBRAL_LENTA_MS ? t : null),
      })
        .then(r => {
          if (id !== requestId.current) return;
          setResults(r);
          setError(null);
          setBuscando(false);
          if (filtro === null) {
            setChips(diccionariosDe(r));
            recordSearch(q, r);   // el historial guarda la búsqueda completa, no la filtrada
          }
        })
        .catch(e => {
          if (id !== requestId.current || e instanceof BusquedaCancelada) return;
          setError(String(e?.message ?? e));
          setBuscando(false);
        });
    }, espera);
    return () => clearTimeout(timer);
  }, [consulta, esperandoToque, filtro, dictHuella]);

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
    <div className={`search${buscando ? " buscando" : ""}`}>
      <div className="search-bar">
        <div className="campo">
          <input
            type="search"
            value={query}
            onChange={e => { setQuery(e.target.value); setErrorPegar(false); }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.aria")}
            lang="ja"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {/* Pegar y buscar: dentro de la barra y solo con ella vacía. Con texto, ese hueco es de la ✕
              del sistema, así que nunca coinciden. */}
          {!query && (
            <button className="boton-pegar" onClick={pegarYBuscar} aria-label={t("search.paste")} title={t("search.paste")}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <rect x="6" y="4" width="12" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <rect x="9" y="2.5" width="6" height="3.5" rx="1" fill="var(--sheet)" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <button className="boton-radicales" lang="ja" onClick={() => setRadicalesAbierto(true)}
          aria-label={t("radicals.open")} title={t("radicals.open")}>部</button>
        <button className="boton-radicales" onClick={() => setDibujoAbierto(true)}
          aria-label={t("draw.open")} title={t("draw.open")}>✎</button>
        {buscando && <div className="cargando" role="status" aria-label={t("search.loading")} />}
      </div>

      {importando && (
        <p className="importando" role="status">
          {importando.stage} · {porcentaje(importando)} %
          <progress value={importando.done} max={importando.total} />
        </p>
      )}

      {dictCount === 0 && !importando && (
        <div className="empty">
          <p>{t("search.noDicts")}</p>
          <button className="primary" onClick={onOpenDicts}>{t("search.import")}</button>
        </div>
      )}

      {errorPegar && !query && <p className="hint aviso-pegar" role="status">{t("search.pasteFailed")}</p>}

      {esFrase(query) && (
        <div className="frase-bloque">
          {/* Un span por carácter: tocar uno busca la palabra que EMPIEZA ahí, como en Yomitan. */}
          <p className="frase" lang={/[가-힣]/.test(query) ? "ko" : "ja"} onClick={tocarFrase} aria-label={t("phrase.aria")}>
            {[...query].map((c, i) => (
              <span
                key={i}
                data-i={i}
                className={foco && i >= foco.inicio && i < foco.inicio + foco.largo ? "en-foco" : undefined}
              >
                {c}
              </span>
            ))}
          </p>
          <p className="hint">{sinPalabra ? t("phrase.none") : !foco ? t("phrase.hint") : null}</p>
        </div>
      )}

      {error && <p className="error">{t("search.failed", { error })}</p>}

      {lenta && !buscando && (
        <p className="tiempos">
          {t("search.slow", {
            total: segundos(lenta.total),
            fases: lenta.fases.filter(([, ms]) => ms >= 50).map(([n, ms]) => `${n} ${segundos(ms)}`).join(" · "),
          })}
        </p>
      )}

      {results && results.length === 0 && dictCount !== 0 && !buscando && (
        <p className="empty">{t("search.noResults", { query: consulta.trim() })}</p>
      )}

      {chips.length > 1 && (
        <div className="filtros" role="group" aria-label={t("search.filterGroup")}>
          <button className={`chip${filtro === null ? " activo" : ""}`} onClick={() => setFiltro(null)}>
            {t("search.filterAll")}
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
          added={anadidas?.get(entryKey(e.expression, e.reading))}
          onKanji={conKanji ? abrirKanji : undefined}
          frase={frase}
          t={t}
          idioma={idioma}
        />
      ))}

      <DibujoKanji
        abierto={dibujoAbierto}
        onClose={() => setDibujoAbierto(false)}
        onKanji={k => setQuery(query + k)}
        consulta={query}
        t={t}
      />
      <RadicalPicker
        abierto={radicalesAbierto}
        onClose={() => setRadicalesAbierto(false)}
        onKanji={k => setQuery(query + k)}
        consulta={query}
        t={t}
      />
      <KanjiSheet
        kanji={kanji}
        anterior={pilaKanji.at(-2)}
        onClose={() => setPilaKanji([])}
        onBuscar={palabra => { setPilaKanji([]); setQuery(palabra); }}
        onKanji={k => setPilaKanji(p => [...p, k])}
        onVolver={() => setPilaKanji(p => p.slice(0, -1))}
        t={t}
      />
    </div>
  );
}
