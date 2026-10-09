import { useEffect, useMemo, useRef, useState } from "react";
import type { T } from "../i18n";

type Datos = typeof import("../busquedaRadicales");

interface Props {
  abierto: boolean;
  onClose: () => void;
  /** Añade el kanji elegido a la barra de búsqueda (al final: así se puede componer 懐石 de dos veces). */
  onKanji: (kanji: string) => void;
  /** Lo que hay en la barra, para ver cómo va quedando sin cerrar la hoja. */
  consulta: string;
  t: T;
}

/**
 * Selector de radicales en una hoja inferior, igual que la ficha de kanji: arriba lo escrito y los
 * kanji que encajan; abajo la cuadrícula. Los radicales que ya no pueden acotar se atenúan.
 */
export function RadicalPicker({ abierto, onClose, onKanji, consulta, t }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  // Los datos (~140 KB) solo se descargan la primera vez que se abre.
  useEffect(() => {
    if (!abierto || datos) return;
    import("../busquedaRadicales").then(setDatos).catch(() => setError(true));
  }, [abierto, datos]);

  const resultado = useMemo(() => (datos ? datos.kanjiConRadicales(elegidos) : []), [datos, elegidos]);
  const utiles = useMemo(() => datos?.radicalesUtiles(elegidos), [datos, elegidos]);
  const total = resultado.reduce((n, g) => n + g.kanji.length, 0);

  const alternar = (clave: string) =>
    setElegidos(e => (e.includes(clave) ? e.filter(x => x !== clave) : [...e, clave]));

  return (
    <dialog
      ref={dialogo}
      className="hoja-kanji hoja-radicales"
      aria-label={t("radicals.title")}
      onClose={onClose}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {abierto && (
        <div className="hoja-contenido">
          <div className="radicales-cabecera">
            <span className="radicales-consulta" lang="ja">{consulta || t("radicals.empty")}</span>
            {elegidos.length > 0 && (
              <button className="text" onClick={() => setElegidos([])}>{t("radicals.clear")}</button>
            )}
            <button className="text" onClick={onClose}>{t("radicals.done")}</button>
          </div>

          {error && <p className="error">{t("radicals.loadError")}</p>}

          {elegidos.length > 0 && (
            <div className="radicales-resultado" lang="ja" aria-live="polite">
              {total === 0 && <p className="hint">{t("radicals.none")}</p>}
              {resultado.map(g => (
                <div key={g.trazos ?? "?"} className="radicales-fila">
                  <span className="radicales-trazos">{g.trazos ?? "?"}</span>
                  {g.kanji.map(k => (
                    <button key={k} className="radicales-kanji" onClick={() => onKanji(k)}>{k}</button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {elegidos.length === 0 && datos && <p className="hint">{t("radicals.hint")}</p>}

          {datos && (
            <div className="radicales-cuadricula" lang="ja">
              {datos.GRUPOS.map(g => (
                <div key={g.trazos} className="radicales-fila">
                  <span className="radicales-trazos">{g.trazos}</span>
                  {g.radicales.map(r => {
                    const elegido = elegidos.includes(r.clave);
                    const util = elegido || !utiles || utiles.has(r.clave);
                    return (
                      <button
                        key={r.clave}
                        className={`radical${elegido ? " elegido" : ""}`}
                        aria-pressed={elegido}
                        disabled={!util}
                        title={r.nombre ?? undefined}
                        onClick={() => alternar(r.clave)}
                      >
                        {r.forma}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <p className="radicales-fuente">{t("radicals.source")}</p>
        </div>
      )}
    </dialog>
  );
}
