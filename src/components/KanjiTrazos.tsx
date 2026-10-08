import { useEffect, useState } from "react";
import { trazosKanji, type Trazos } from "../trazos";
import type { T } from "../i18n";

/** Lo que tarda en dibujarse cada trazo al animar, en segundos. */
const DURACION_TRAZO = 0.45;

/**
 * Orden de trazos: el kanji dibujado con KanjiVG y cada trazo numerado. «Ver trazos» lo dibuja
 * trazo a trazo. La animación es CSS (stroke-dashoffset con pathLength=1), sin librerías.
 */
export function KanjiTrazos({ kanji, t }: { kanji: string; t: T }) {
  const [trazos, setTrazos] = useState<Trazos | null | undefined>(undefined);
  const [error, setError] = useState(false);
  // Cambiar la clave vuelve a montar los trazos y reinicia la animación.
  const [animacion, setAnimacion] = useState(0);

  useEffect(() => {
    setTrazos(undefined);
    setError(false);
    setAnimacion(0);
    let cancelado = false;
    trazosKanji(kanji)
      .then(r => { if (!cancelado) setTrazos(r); })
      .catch(() => { if (!cancelado) setError(true); });
    return () => { cancelado = true; };
  }, [kanji]);

  if (error) return <p className="hint trazos-aviso">{t("kanji.strokesOffline")}</p>;
  if (trazos === null) return null;               // KanjiVG no tiene este kanji

  return (
    <figure className="trazos">
      <svg
        key={animacion}
        className={`trazos-svg${animacion ? " animando" : ""}`}
        viewBox="0 0 109 109"
        role="img"
        aria-label={t("kanji.strokeOrder", { kanji })}
      >
        {/* Cuadrícula de práctica, como en los cuadernos de kanji. */}
        <path className="trazos-guia" d="M54.5 0V109M0 54.5H109" />
        {trazos?.trazos.map((d, i) => (
          <path
            key={i}
            className="trazos-trazo"
            d={d}
            pathLength={1}
            style={animacion ? { animationDelay: `${i * DURACION_TRAZO}s`, animationDuration: `${DURACION_TRAZO}s` } : undefined}
          />
        ))}
        {trazos?.numeros.map((n, i) => (
          <text
            key={i}
            className="trazos-numero"
            x={n.x}
            y={n.y}
            style={animacion ? { animationDelay: `${i * DURACION_TRAZO}s` } : undefined}
          >
            {i + 1}
          </text>
        ))}
      </svg>
      <figcaption>
        <button className="text" disabled={!trazos} onClick={() => setAnimacion(a => a + 1)}>
          {t("kanji.playStrokes")}
        </button>
        <span className="trazos-fuente">{t("kanji.strokesSource")}</span>
      </figcaption>
    </figure>
  );
}
