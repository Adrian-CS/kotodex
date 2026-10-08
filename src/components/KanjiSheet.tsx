import { useEffect, useRef, useState } from "react";
import { fichaKanji, palabrasConKanji, partirOkurigana, type FichaKanji, type PalabraConKanji } from "../kanji";
import type { T } from "../i18n";

interface Props {
  /** El kanji a enseñar; null = hoja cerrada. */
  kanji: string | null;
  onClose: () => void;
  /** Buscar una palabra de la lista: cierra la hoja y la pone en la barra de búsqueda. */
  onBuscar: (palabra: string) => void;
  t: T;
}

/** Grado escolar de KANJIDIC: 1–6 primaria, 8 resto de los jōyō, 9–10 solo para nombres. */
function textoGrado(grado: number, t: T): string {
  if (grado <= 6) return t("kanji.gradePrimary", { grade: grado });
  if (grado === 8) return t("kanji.gradeSecondary");
  return t("kanji.gradeNames");
}

export function KanjiSheet({ kanji, onClose, onBuscar, t }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [ficha, setFicha] = useState<FichaKanji | null | undefined>(undefined);
  const [palabras, setPalabras] = useState<PalabraConKanji[]>([]);

  // <dialog> nativo: en iOS trae el fondo, el foco y cerrar con gestos sin escribir nada.
  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (kanji && !d.open) d.showModal();
    if (!kanji && d.open) d.close();
  }, [kanji]);

  useEffect(() => {
    setFicha(undefined);
    setPalabras([]);
    if (!kanji) return;
    let cancelado = false;
    fichaKanji(kanji).then(f => { if (!cancelado) setFicha(f); });
    palabrasConKanji(kanji).then(p => { if (!cancelado) setPalabras(p); });
    return () => { cancelado = true; };
  }, [kanji]);

  const datos = ficha ? [
    ficha.strokes !== undefined && t("kanji.strokes", { count: ficha.strokes }),
    ficha.grade !== undefined && textoGrado(ficha.grade, t),
    ficha.jlpt !== undefined && t("kanji.jlpt", { level: ficha.jlpt }),
    ficha.freq !== undefined && t("kanji.freq", { rank: ficha.freq }),
  ].filter(Boolean) : [];

  return (
    <dialog
      ref={dialogo}
      className="hoja-kanji"
      aria-label={kanji ? t("kanji.title", { kanji }) : undefined}
      onClose={onClose}
      // Tocar fuera de la hoja (en el fondo) la cierra.
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {kanji && (
        <div className="hoja-contenido">
          <header className="hoja-cabecera">
            <div className="hoja-kanji-grande" lang="ja">{kanji}</div>
            {datos.length > 0 && <p className="hoja-datos">{datos.join(" · ")}</p>}
          </header>

          {ficha === null && <p className="hint">{t("kanji.missing")}</p>}

          {ficha && (
            <dl className="hoja-lecturas" lang="ja">
              {ficha.onyomi.length > 0 && (
                <>
                  <dt>{t("kanji.on")}</dt>
                  <dd>{ficha.onyomi.join("、")}</dd>
                </>
              )}
              {ficha.kunyomi.length > 0 && (
                <>
                  <dt>{t("kanji.kun")}</dt>
                  <dd>
                    {ficha.kunyomi.map((k, i) => {
                      const [raiz, okurigana] = partirOkurigana(k);
                      return (
                        <span key={k}>
                          {i > 0 && "、"}
                          {raiz}{okurigana && <span className="okurigana">{okurigana}</span>}
                        </span>
                      );
                    })}
                  </dd>
                </>
              )}
            </dl>
          )}

          {ficha?.significados.map(s => (
            <section key={s.dictTitle} className="hoja-significados">
              {ficha.significados.length > 1 && <div className="dict-name">{s.dictTitle}</div>}
              <p>{s.meanings.join(", ")}</p>
            </section>
          ))}

          {palabras.length > 0 && (
            <section className="hoja-palabras">
              <h3 className="defs-label">{t("kanji.words", { kanji })}</h3>
              <ul>
                {palabras.map(p => (
                  <li key={`${p.expression}|${p.reading}`}>
                    <button className="hoja-palabra" onClick={() => onBuscar(p.expression)}>
                      <span className="hoja-palabra-termino" lang="ja">{p.expression}</span>
                      {p.reading !== p.expression && <span className="hoja-palabra-lectura" lang="ja">{p.reading}</span>}
                      <span className="hoja-palabra-def">{p.gloss}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button className="hoja-cerrar" onClick={onClose}>{t("kanji.close")}</button>
        </div>
      )}
    </dialog>
  );
}
