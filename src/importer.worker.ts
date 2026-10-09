// Importación de diccionarios fuera del hilo principal.
//
// Leer el JSON de JMdict, calcular el índice de palabras de cada término y escribir 500.000 filas
// en IndexedDB congelaba la app un buen rato en el iPhone. Aquí lo hace un worker con su propia
// conexión a la base de datos; la interfaz sigue respondiendo y se puede buscar mientras tanto.

import { importarEnEsteHilo, type ImportProgress } from "./importer";

export type MensajeImportacion =
  | { tipo: "progreso"; progreso: ImportProgress }
  | { tipo: "hecho"; titulo: string }
  | { tipo: "error"; mensaje: string };

const enviar = (m: MensajeImportacion) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<File>) => {
  try {
    const d = await importarEnEsteHilo(e.data, progreso => enviar({ tipo: "progreso", progreso }), true);
    enviar({ tipo: "hecho", titulo: d.title });
  } catch (err) {
    enviar({ tipo: "error", mensaje: err instanceof Error ? err.message : String(err) });
  }
};
