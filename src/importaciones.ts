// Cola de importaciones, compartida por toda la app.
//
// El estado vive aquí y no en la pantalla de Diccionarios: así la importación sigue (y se ve su
// progreso desde la búsqueda) aunque se cambie de pestaña. Cada archivo va a un worker nuevo; si el
// navegador no tiene workers, se importa en el hilo principal como antes.

import { useSyncExternalStore } from "react";
import { importarEnEsteHilo, type ImportProgress } from "./importer";
import type { MensajeImportacion } from "./importer.worker";

export interface EstadoImportacion {
  /** Lo que se está importando ahora, o null si nada. */
  progreso: ImportProgress | null;
  /** Archivos que esperan turno detrás del actual. */
  pendientes: number;
  /** Errores de esta tanda, uno por archivo que falló. */
  errores: string[];
}

let estado: EstadoImportacion = { progreso: null, pendientes: 0, errores: [] };
const oyentes = new Set<() => void>();
const cola: File[] = [];
let trabajando = false;

function cambiar(parcial: Partial<EstadoImportacion>) {
  estado = { ...estado, ...parcial };
  oyentes.forEach(f => f());
}

function importarUno(file: File): Promise<void> {
  if (typeof Worker === "undefined") {
    return importarEnEsteHilo(file, progreso => cambiar({ progreso })).then(() => undefined);
  }
  return new Promise((resolver, rechazar) => {
    const w = new Worker(new URL("./importer.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<MensajeImportacion>) => {
      const m = e.data;
      if (m.tipo === "progreso") cambiar({ progreso: m.progreso });
      else {
        w.terminate();
        if (m.tipo === "hecho") resolver(); else rechazar(new Error(m.mensaje));
      }
    };
    w.onerror = e => { w.terminate(); rechazar(new Error(e.message || "El importador falló.")); };
    w.postMessage(file);
  });
}

async function procesar() {
  if (trabajando) return;
  trabajando = true;
  while (cola.length) {
    const file = cola.shift()!;
    cambiar({ pendientes: cola.length, progreso: { stage: file.name, done: 0, total: 1 } });
    try {
      await importarUno(file);
    } catch (e) {
      cambiar({ errores: [...estado.errores, e instanceof Error ? e.message : String(e)] });
    }
  }
  trabajando = false;
  cambiar({ progreso: null, pendientes: 0 });
  // Pedir almacenamiento persistente es cosa de la ventana, no del worker.
  navigator.storage?.persist?.().catch(() => {});
}

/** Pone los archivos en cola. Una tanda nueva empieza con los errores de la anterior borrados. */
export function importar(files: File[]) {
  if (!trabajando) cambiar({ errores: [] });
  cola.push(...files);
  procesar();
}

export function useImportacion(): EstadoImportacion {
  return useSyncExternalStore(
    f => { oyentes.add(f); return () => oyentes.delete(f); },
    () => estado,
  );
}

/** 0–100, para la barra. */
export const porcentaje = (p: ImportProgress) => Math.round((100 * p.done) / Math.max(1, p.total));
