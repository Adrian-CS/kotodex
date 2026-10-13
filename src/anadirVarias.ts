// Añadir a Anki varias palabras del historial de una vez (tras una sesión de lectura).
//
// Solo con servidor: con AnkiMobile cada tarjeta abre la app y sale de la PWA, así que «varias»
// serían N saltos de app. Se mandan de una en una (el servidor tiene un solo worker y una sola
// colección: en paralelo no iría más rápido) y cada una se arma igual que desde su ficha.

import { buildFields } from "./anki";
import { db, entryKey, type Lookup } from "./db";
import { search } from "./search";
import { addNote, ServerError } from "./server";
import type { Settings } from "./settings";

export interface ResultadoVarias {
  añadidas: number;
  /** Ya estaban en la colección (el servidor las rechaza como duplicadas): no se fuerzan. */
  yaEstaban: number;
  /** Las que fallaron por otra cosa, con el motivo. */
  fallos: { palabra: string; motivo: string }[];
  /** El servidor sincroniza solo después: en cuántos segundos, según la última respuesta. */
  syncEnSegundos: number | null;
}

export async function anadirVarias(
  palabras: Lookup[],
  settings: Settings,
  deck: string,
  alAvanzar: (hechas: number) => void,
): Promise<ResultadoVarias> {
  const r: ResultadoVarias = { añadidas: 0, yaEstaban: 0, fallos: [], syncEnSegundos: null };
  for (const [i, p] of palabras.entries()) {
    alAvanzar(i);
    try {
      // La ficha de esa palabra exacta (expresión Y lectura): 箸 y 橋 comparten búsqueda.
      const fichas = await search(p.expression);
      const ficha = fichas.find(e => e.expression === p.expression && e.reading === p.reading) ?? fichas[0];
      if (!ficha) throw new Error("ya no está en los diccionarios activos");
      const nota = await addNote(settings, buildFields(ficha), deck);
      await db.added.put({ key: entryKey(ficha.expression, ficha.reading), deck, at: Date.now() });
      r.añadidas++;
      r.syncEnSegundos = nota.sync_in_seconds ?? null;
    } catch (e) {
      if (e instanceof ServerError && e.duplicate) r.yaEstaban++;
      else r.fallos.push({ palabra: p.expression, motivo: e instanceof Error ? e.message : String(e) });
      // Sin conexión con el servidor no tiene sentido seguir probando con el resto.
      if (e instanceof ServerError && e.status === 0) break;
    }
  }
  alAvanzar(palabras.length);
  return r;
}
