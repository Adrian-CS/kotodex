import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, entryKey } from "../db";
import { search, type Entry } from "../search";
import type { Settings } from "../settings";
import type { Idioma, T } from "../i18n";
import { quitarResalte } from "../tocarTexto";
import { EntryCard } from "./EntryCard";

/** Una palabra tocada en una definición casi siempre es la primera; unas pocas bastan. */
const MAX_FICHAS = 5;

interface Props {
  /** Palabras abiertas, la última encima; vacía = hoja cerrada. */
  pila: string[];
  onClose: () => void;
  onVolver: () => void;
  /** Tocar otra palabra dentro de esta hoja: se apila. */
  onPalabra: (palabra: string) => void;
  onKanji?: (kanji: string) => void;
  /** Llevar la palabra a la barra de búsqueda (cierra la hoja). */
  onBuscar: (palabra: string) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  t: T;
  idioma: Idioma;
}

/**
 * La ficha de una palabra tocada dentro de una definición, encima de la búsqueda, como en Yomitan.
 * Las definiciones de aquí también se pueden tocar: se apilan y «← Volver» deshace.
 */
export function PalabraSheet({ pila, onClose, onVolver, onPalabra, onKanji, onBuscar, settings, setSettings, t, idioma }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const palabra = pila.at(-1) ?? null;
  const [fichas, setFichas] = useState<Entry[] | null>(null);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (palabra && !d.open) d.showModal();
    if (!palabra && d.open) d.close();
    if (!palabra) quitarResalte();
  }, [palabra]);

  useEffect(() => {
    setFichas(null);
    if (!palabra) return;
    dialogo.current?.scrollTo({ top: 0 });
    let cancelado = false;
    search(palabra).then(r => { if (!cancelado) setFichas(r.slice(0, MAX_FICHAS)); }).catch(() => { if (!cancelado) setFichas([]); });
    return () => { cancelado = true; };
  }, [palabra]);

  const claves = fichas?.map(e => entryKey(e.expression, e.reading)) ?? [];
  const anadidas = useLiveQuery(
    async () => new Map((await db.added.bulkGet(claves)).filter(a => a !== undefined).map(a => [a.key, a])),
    [claves.join("|")],
  );

  return (
    <dialog
      ref={dialogo}
      className="hoja-kanji hoja-ficha"
      aria-label={palabra ?? undefined}
      onClose={onClose}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {palabra && (
        <div className="hoja-contenido">
          <div className="hoja-ficha-cabecera">
            {pila.length > 1
              ? <button className="text hoja-volver" onClick={onVolver}>{t("kanji.back", { kanji: pila.at(-2)! })}</button>
              : <span />}
            {/* La forma de diccionario de la primera ficha (食べる), no el trozo tocado (食べ). */}
            <button className="text" onClick={() => onBuscar(fichas?.[0]?.expression ?? palabra)}>{t("word.search")}</button>
          </div>
          {fichas === null && <p className="hint">{t("word.loading")}</p>}
          {fichas?.length === 0 && <p className="hint">{t("search.noResults", { query: palabra })}</p>}
          {fichas?.map(e => (
            <EntryCard
              key={`${e.expression}|${e.reading}`}
              entry={e}
              settings={settings}
              setSettings={setSettings}
              added={anadidas?.get(entryKey(e.expression, e.reading))}
              onKanji={onKanji}
              onPalabra={onPalabra}
              t={t}
              idioma={idioma}
            />
          ))}
          <button className="hoja-cerrar" onClick={onClose}>{t("kanji.close")}</button>
        </div>
      )}
    </dialog>
  );
}
