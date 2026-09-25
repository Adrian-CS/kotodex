// Historial de palabras consultadas.
//
// Dos cosas que hay que evitar para que la lista sea útil y no un registro de pulsaciones:
//   - Escribir 食べる deja 食, 食べ y 食べる. Si la consulta nueva empieza por la anterior y ha
//     pasado poco rato, se borra la anterior: se queda solo la forma final.
//   - Buscar 食べた y 食べる lleva a la misma palabra. Se indexa por la palabra a la que se llega,
//     no por lo tecleado, así que queda una sola entrada con la fecha más reciente.

import { db, entryKey, type Lookup } from "./db";
import type { Entry } from "./search";

const VENTANA_MS = 2 * 60 * 1000;
export const MAX_HISTORIAL = 300;

/** Lo último que se guardó, para poder sustituirlo si el usuario sigue escribiendo. */
let ultimo: { key: string; query: string; at: number } | null = null;

export async function recordSearch(query: string, results: Entry[]): Promise<void> {
  const q = query.trim();
  if (!q || !results.length) return;   // no guardar lo que no encontró nada

  const primera = results[0];
  const fila: Lookup = {
    key: entryKey(primera.expression, primera.reading),
    expression: primera.expression,
    reading: primera.reading,
    query: q,
    at: Date.now(),
    hits: results.length,
  };

  try {
    const previo = ultimo;
    const encadena = previo && previo.key !== fila.key && q.startsWith(previo.query)
      && fila.at - previo.at < VENTANA_MS;

    await db.transaction("rw", db.lookups, async () => {
      if (encadena) await db.lookups.delete(previo!.key);
      await db.lookups.put(fila);
    });
    ultimo = { key: fila.key, query: q, at: fila.at };
    await podar();
  } catch {
    /* el historial es un extra: si falla, la búsqueda sigue funcionando */
  }
}

/** Deja solo las MAX_HISTORIAL más recientes. */
async function podar(): Promise<void> {
  const total = await db.lookups.count();
  if (total <= MAX_HISTORIAL) return;
  const sobran = await db.lookups.orderBy("at").limit(total - MAX_HISTORIAL).toArray();
  await db.lookups.bulkDelete(sobran.map(l => l.key));
}

export async function clearHistory(): Promise<void> {
  ultimo = null;
  await db.lookups.clear();
}
