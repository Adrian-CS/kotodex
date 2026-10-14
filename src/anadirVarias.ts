// Añadir a Anki varias palabras del historial de una vez (tras una sesión de lectura).
//
// Solo con servidor: con AnkiMobile cada tarjeta abre la app y sale de la PWA, así que «varias»
// serían N saltos de app. Se mandan de una en una (el servidor tiene un solo worker y una sola
// colección: en paralelo no iría más rápido) y cada una se arma igual que desde su ficha.

import { buildFields } from "./anki";
import { db, entryKey, type Lookup } from "./db";
import { search } from "./search";
import { addNote, ServerError } from "./server";
import { encolar, esFalloDeConexion } from "./pendientes";
import type { Settings } from "./settings";

export interface ResultadoVarias {
  añadidas: number;
  /** Ya estaban en la colección (el servidor las rechaza como duplicadas): no se fuerzan. */
  yaEstaban: number;
  /** Las que fallaron por otra cosa, con el motivo. */
  fallos: { palabra: string; motivo: string }[];
  /** Sin conexión con el servidor: quedan en la cola y se mandan solas al volver (pendientes.ts). */
  encoladas: number;
  /** El servidor sincroniza solo después: en cuántos segundos, según la última respuesta. */
  syncEnSegundos: number | null;
}

export async function anadirVarias(
  palabras: Lookup[],
  settings: Settings,
  deck: string,
  alAvanzar: (hechas: number) => void,
): Promise<ResultadoVarias> {
  const r: ResultadoVarias = { añadidas: 0, yaEstaban: 0, fallos: [], encoladas: 0, syncEnSegundos: null };
  // Tras el primer fallo de conexión no se intenta el resto: se encola directamente.
  let sinConexion = false;
  for (const [i, p] of palabras.entries()) {
    alAvanzar(i);
    let campos: ReturnType<typeof buildFields> | null = null;
    let clave = "";
    try {
      // La ficha de esa palabra exacta (expresión Y lectura): 箸 y 橋 comparten búsqueda.
      const fichas = await search(p.expression);
      const ficha = fichas.find(e => e.expression === p.expression && e.reading === p.reading) ?? fichas[0];
      if (!ficha) throw new Error("ya no está en los diccionarios activos");
      campos = buildFields(ficha);
      clave = entryKey(ficha.expression, ficha.reading);
      if (sinConexion) throw new ServerError("sin conexión", 0);
      const nota = await addNote(settings, campos, deck);
      await db.added.put({ key: clave, deck, at: Date.now() });
      r.añadidas++;
      r.syncEnSegundos = nota.sync_in_seconds ?? null;
    } catch (e) {
      if (esFalloDeConexion(e) && campos) {
        sinConexion = true;
        await encolar(clave, p.expression, campos, deck);
        r.encoladas++;
      } else if (e instanceof ServerError && e.duplicate) r.yaEstaban++;
      else r.fallos.push({ palabra: p.expression, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  alAvanzar(palabras.length);
  return r;
}
