// Importación de diccionarios fuera del hilo principal.
//
// Leer el JSON de JMdict, calcular el índice de palabras de cada término y escribir 500.000 filas
// en IndexedDB congelaba la app un buen rato en el iPhone. Aquí lo hace un worker con su propia
// conexión a la base de datos; la interfaz sigue respondiendo y se puede buscar mientras tanto.

import { importarEnEsteHilo, type ImportProgress } from "./importer";
import { indexarDiccionario } from "./indiceKanji";

/** Lo que se le pide al worker: importar un .zip o indexar los kanji de un diccionario ya importado. */
export type TrabajoImportacion = File | { indexar: number; titulo: string };

export type MensajeImportacion =
  | { tipo: "progreso"; progreso: ImportProgress }
  | { tipo: "hecho"; titulo: string }
  | { tipo: "error"; mensaje: string };

const enviar = (m: MensajeImportacion) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<TrabajoImportacion>) => {
  try {
    const trabajo = e.data;
    if (trabajo instanceof File) {
      const d = await importarEnEsteHilo(trabajo, progreso => enviar({ tipo: "progreso", progreso }), true);
      enviar({ tipo: "hecho", titulo: d.title });
      return;
    }
    const stage = `Preparando los kanji de «${trabajo.titulo}»`;
    await indexarDiccionario(trabajo.indexar, (done, total) => enviar({ tipo: "progreso", progreso: { stage, done, total } }));
    enviar({ tipo: "hecho", titulo: trabajo.titulo });
  } catch (err) {
    enviar({ tipo: "error", mensaje: err instanceof Error ? err.message : String(err) });
  }
};
