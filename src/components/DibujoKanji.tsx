import { useCallback, useEffect, useRef, useState } from "react";
import type { T } from "../i18n";
import type { Trazo } from "../reconocerKanji";

type Reconocedor = typeof import("../reconocerKanji");

interface Props {
  abierto: boolean;
  onClose: () => void;
  /** Añade el kanji elegido a la barra de búsqueda, como en la búsqueda por radicales. */
  onKanji: (kanji: string) => void;
  consulta: string;
  t: T;
}

/** Lado del lienzo en píxeles CSS; se encoge en pantallas estrechas. */
const LADO_MAX = 300;

/**
 * Buscar dibujando: un recuadro con cuadrícula de práctica, y encima los candidatos, que se
 * recalculan al terminar cada trazo. Tocar uno lo añade a la búsqueda y deja el recuadro limpio
 * para el siguiente kanji.
 */
export function DibujoKanji({ abierto, onClose, onKanji, consulta, t }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [reconocedor, setReconocedor] = useState<Reconocedor | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [trazos, setTrazos] = useState<Trazo[]>([]);
  const [candidatos, setCandidatos] = useState<string[]>([]);
  // El trazo en curso vive en una ref: actualizar estado con cada punto repintaría React sin parar.
  const actual = useRef<Trazo | null>(null);
  const [lado, setLado] = useState(LADO_MAX);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  // Librería y patrones (~510 KB) solo la primera vez que se abre.
  useEffect(() => {
    if (!abierto || estado === "listo") return;
    setEstado("cargando");
    import("../reconocerKanji")
      .then(async r => { await r.prepararReconocedor(); setReconocedor(r); setEstado("listo"); })
      .catch(() => setEstado("error"));
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (abierto) setLado(Math.min(LADO_MAX, window.innerWidth - 32));
  }, [abierto]);

  const pintar = useCallback(() => {
    const c = lienzo.current;
    if (!c) return;
    const escala = window.devicePixelRatio || 1;
    // Ancho Y alto: el lienzo nace con 300×150, y con 300 de ancho solo mirar el ancho dejaba la
    // altura a la mitad y el dibujo estirado.
    const px = Math.round(lado * escala);
    if (c.width !== px || c.height !== px) { c.width = px; c.height = px; }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(escala, 0, 0, escala, 0, 0);
    ctx.clearRect(0, 0, lado, lado);
    const estilo = getComputedStyle(c);
    // Cuadrícula de práctica, en el color de las reglas.
    ctx.strokeStyle = estilo.getPropertyValue("--rule").trim() || "#ddd";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(lado / 2, 0); ctx.lineTo(lado / 2, lado);
    ctx.moveTo(0, lado / 2); ctx.lineTo(lado, lado / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = estilo.getPropertyValue("--ink").trim() || "#000";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const trazo of actual.current ? [...trazos, actual.current] : trazos) {
      ctx.beginPath();
      trazo.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (trazo.length === 1) ctx.lineTo(trazo[0][0] + 0.1, trazo[0][1]);
      ctx.stroke();
    }
  }, [trazos, lado]);

  useEffect(() => { if (abierto) pintar(); }, [abierto, pintar]);

  // Reconocer al cambiar los trazos (al soltar el dedo, al deshacer o al borrar).
  useEffect(() => {
    if (!reconocedor || !trazos.length) { setCandidatos([]); return; }
    let cancelado = false;
    reconocedor.reconocer(trazos).then(c => { if (!cancelado) setCandidatos(c); });
    return () => { cancelado = true; };
  }, [trazos, reconocedor]);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const empezar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    actual.current = [punto(e)];
    pintar();
  };
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!actual.current) return;
    actual.current.push(punto(e));
    pintar();
  };
  const terminar = () => {
    const trazo = actual.current;
    actual.current = null;
    if (trazo) setTrazos(ts => [...ts, trazo]);
  };

  const borrar = () => { setTrazos([]); setCandidatos([]); };
  const elegir = (k: string) => { onKanji(k); borrar(); };

  return (
    <dialog
      ref={dialogo}
      className="hoja-kanji hoja-dibujo"
      aria-label={t("draw.title")}
      onClose={onClose}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {abierto && (
        <div className="hoja-contenido">
          <div className="radicales-cabecera">
            <span className="radicales-consulta" lang="ja">{consulta || t("draw.empty")}</span>
            <button className="text" onClick={onClose}>{t("radicals.done")}</button>
          </div>

          <div className="dibujo-candidatos" lang="ja" aria-live="polite">
            {candidatos.map(k => (
              <button key={k} className="radicales-kanji" onClick={() => elegir(k)}>{k}</button>
            ))}
            {estado === "listo" && trazos.length > 0 && !candidatos.length && <span className="hint">{t("draw.none")}</span>}
            {estado === "listo" && !trazos.length && <span className="hint">{t("draw.hint")}</span>}
            {estado === "cargando" && <span className="hint">{t("draw.loading")}</span>}
            {estado === "error" && <span className="error">{t("draw.loadError")}</span>}
          </div>

          <canvas
            ref={lienzo}
            className="dibujo-lienzo"
            style={{ width: lado, height: lado }}
            aria-label={t("draw.canvas")}
            onPointerDown={empezar}
            onPointerMove={mover}
            onPointerUp={terminar}
            onPointerCancel={terminar}
          />

          <div className="dibujo-acciones">
            <button disabled={!trazos.length} onClick={() => setTrazos(ts => ts.slice(0, -1))}>{t("draw.undo")}</button>
            <button disabled={!trazos.length} onClick={borrar}>{t("radicals.clear")}</button>
          </div>
          <p className="radicales-fuente">
            {t("draw.source")}{" "}
            <a href="https://github.com/asdfjkl/kanjicanvas" target="_blank" rel="noreferrer">github.com/asdfjkl/kanjicanvas</a>
          </p>
        </div>
      )}
    </dialog>
  );
}
