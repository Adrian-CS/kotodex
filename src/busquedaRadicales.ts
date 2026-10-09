// Buscar un kanji por sus partes, como en Jisho: se marcan 氵 y 田 y salen los kanji que llevan las dos.
//
// Los datos son RADKFILE y KANJIDIC2 de la EDRDG (CC BY-SA 4.0) y los nombres de los radicales de
// Kanji alive (CC BY 4.0), empaquetados en @johnmorrisdotca/bushu, que también trae la lógica: la
// intersección y qué radicales siguen pudiendo acotar (los demás se atenúan). Son ~140 KB, así que
// este módulo se carga con import() al abrir el selector, no al arrancar.

import { kanjiForRadicals, radicalForm, radicalGroups, usableRadicals, withCorrectedStrokes } from "@johnmorrisdotca/bushu";
import { RADKFILE } from "@johnmorrisdotca/bushu/radkfile";
import { radicalName } from "@johnmorrisdotca/bushu/names";
import { sortByStrokes, strokesOf } from "@johnmorrisdotca/bushu/strokes";

// Con los dos recuentos de trazos que el paquete corrige respecto a RADKFILE.
const RADICALES = withCorrectedStrokes(RADKFILE.radicals);

export interface GrupoRadicales {
  trazos: number;
  /** Clave de RADKFILE (lo que se guarda) y forma que se dibuja: 汁 se ve como 氵. */
  radicales: { clave: string; forma: string; nombre: string | null }[];
}

/** La cuadrícula: radicales agrupados por número de trazos. */
export const GRUPOS: GrupoRadicales[] = radicalGroups(RADICALES).map(g => ({
  trazos: g.strokes,
  radicales: g.radicals.map(clave => ({ clave, forma: radicalForm(clave), nombre: radicalName(clave) })),
}));

/** Kanji que llevan TODOS los radicales elegidos, agrupados por trazos (los más simples primero). */
export function kanjiConRadicales(elegidos: string[]): { trazos: number | null; kanji: string[] }[] {
  const grupos: { trazos: number | null; kanji: string[] }[] = [];
  for (const k of sortByStrokes(kanjiForRadicals(RADICALES, elegidos))) {
    const trazos = strokesOf(k);
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.trazos === trazos) ultimo.kanji.push(k);
    else grupos.push({ trazos, kanji: [k] });
  }
  return grupos;
}

/** Radicales que aún pueden acotar el resultado; el resto se atenúa. */
export const radicalesUtiles = (elegidos: string[]): Set<string> => usableRadicals(RADICALES, elegidos);
