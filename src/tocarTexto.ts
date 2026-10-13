// Tocar una palabra dentro de una definición (o de cualquier HTML ya pintado) y saber qué texto
// empieza ahí. Es lo mismo que la frase tocable de SearchView, pero sobre HTML ajeno: no hay un
// span por carácter, así que se mira qué carácter hay bajo el dedo con caretRangeFromPoint.

import { palabraEn } from "./frase";

/** Un carácter que puede empezar una palabra buscable: kana, kanji o hangul. */
const BUSCABLE = /[぀-ヿ㐀-䶿一-鿿々가-힣]/;
/** Más que cualquier palabra (frase.ts mira hasta 10), por si el corte cae a mitad. */
const MAX_CARACTERES = 12;
/** Lo que separa entradas: una palabra no sigue de un <li> al siguiente. */
const BLOQUE = "div, li, p, td, th, dd, dt, summary, section";
const RESALTE = "kotodex-toque";

interface Posicion { nodo: Text; offset: number; largo: number }

/** El punto de texto bajo (x, y). Safari y Chromium tienen caretRangeFromPoint; Firefox, el estándar. */
function caretEn(x: number, y: number): { nodo: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p && { nodo: p.offsetNode, offset: p.offset };
  }
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { nodo: r.startContainer, offset: r.startOffset } : null;
}

/** Largo en unidades UTF-16 del carácter que empieza en `i` (2 para kanji de los planos altos). */
const largoEn = (s: string, i: number) => ((s.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);

/**
 * El caret cae ENTRE caracteres: tocar la mitad derecha de 食 lo pone detrás. Se comprueba cuál de
 * los dos vecinos contiene de verdad el punto.
 */
function caracterTocado(nodo: Text, offset: number, x: number, y: number): number | null {
  for (const i of [offset, offset - 1, offset - 2]) {
    if (i < 0 || i >= nodo.length) continue;
    const r = document.createRange();
    r.setStart(nodo, i);
    r.setEnd(nodo, i + largoEn(nodo.data, i));
    for (const caja of r.getClientRects()) {
      if (x >= caja.left && x <= caja.right && y >= caja.top && y <= caja.bottom) return i;
    }
  }
  return null;
}

/**
 * Los caracteres desde el tocado, recorriendo los nodos de texto siguientes (una palabra puede
 * venir partida en varios <span>), sin entrar en furigana (<rt>) ni saltar a otro bloque.
 */
function caracteresDesde(contenedor: HTMLElement, nodo: Text, offset: number): Posicion[] {
  const bloque = (n: Node) => n.parentElement?.closest(BLOQUE) ?? contenedor;
  const inicio = bloque(nodo);
  const andador = document.createTreeWalker(contenedor, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement?.closest("rt, rp") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  andador.currentNode = nodo;
  const posiciones: Posicion[] = [];
  for (let actual: Text | null = nodo, desde = offset; actual; actual = andador.nextNode() as Text | null, desde = 0) {
    if (actual !== nodo && bloque(actual) !== inicio) break;
    for (let i = desde; i < actual.length && posiciones.length < MAX_CARACTERES; i += largoEn(actual.data, i)) {
      posiciones.push({ nodo: actual, offset: i, largo: largoEn(actual.data, i) });
    }
    if (posiciones.length >= MAX_CARACTERES) break;
  }
  return posiciones;
}

/** Marca la palabra tocada con la CSS Custom Highlight API (Safari 17.2+), sin tocar el DOM. */
function resaltar(rango: Range | null) {
  const css = globalThis.CSS as (typeof CSS & { highlights?: Map<string, unknown> }) | undefined;
  const Highlight = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !Highlight) return;
  if (rango) css.highlights.set(RESALTE, new Highlight(rango));
  else css.highlights.delete(RESALTE);
}

export const quitarResalte = () => resaltar(null);

/**
 * La palabra que empieza donde se tocó dentro de `contenedor`, o null si ahí no empieza ninguna
 * de los diccionarios (o se tocó texto latino: eso no se busca). La deja resaltada.
 */
export async function palabraTocada(contenedor: HTMLElement, x: number, y: number): Promise<string | null> {
  const caret = caretEn(x, y);
  if (!caret || !(caret.nodo instanceof Text) || !contenedor.contains(caret.nodo)) return null;
  if (caret.nodo.parentElement?.closest("rt, rp")) return null;
  const i = caracterTocado(caret.nodo, caret.offset, x, y);
  if (i === null || !BUSCABLE.test(String.fromCodePoint(caret.nodo.data.codePointAt(i)!))) return null;

  const posiciones = caracteresDesde(contenedor, caret.nodo, i);
  const texto = posiciones.map(p => p.nodo.data.slice(p.offset, p.offset + p.largo)).join("");
  const largo = await palabraEn(texto, 0);
  if (!largo) return null;

  const rango = document.createRange();
  const ultima = posiciones[largo - 1];
  rango.setStart(posiciones[0].nodo, posiciones[0].offset);
  rango.setEnd(ultima.nodo, ultima.offset + ultima.largo);
  resaltar(rango);
  return [...texto].slice(0, largo).join("");
}
