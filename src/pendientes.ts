// Tarjetas que no llegaron al servidor por falta de conexión (en el tren, con Tailscale apagado…).
//
// En vez de perderlas, se guardan en IndexedDB ya armadas y se mandan solas cuando vuelve la
// conexión: al abrir la app, al volver a ella, cuando el sistema avisa de que hay red y, mientras
// quede alguna, cada minuto. Solo se encola un fallo de CONEXIÓN; un error del servidor (falta el
// tipo de nota, token incorrecto…) se enseña como siempre, porque reintentar no lo arreglaría.

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { NoteFields } from "./anki";
import { db, type Pendiente } from "./db";
import { addNote, ServerError } from "./server";
import type { Settings } from "./settings";

export const esFalloDeConexion = (e: unknown) => e instanceof ServerError && e.status === 0;

export async function encolar(key: string, expression: string, fields: NoteFields, deck: string): Promise<void> {
  // Una sola por palabra: tocar «Añadir» dos veces sin red no debe dejar dos tarjetas.
  await db.transaction("rw", db.pendientes, async () => {
    await db.pendientes.filter(p => p.key === key).delete();
    await db.pendientes.add({ key, expression, fields: { ...fields }, deck, at: Date.now() });
  });
}

let enviando: Promise<void> | null = null;

/** Manda lo pendiente, en orden. Para en el primer fallo de conexión; nunca dos envíos a la vez. */
export function enviarPendientes(settings: Settings): Promise<void> {
  if (settings.mode !== "server" || !settings.serverUrl || !settings.serverToken) return Promise.resolve();
  enviando ??= (async () => {
    try {
      for (const p of await db.pendientes.orderBy("at").toArray()) {
        try {
          await addNote(settings, p.fields as unknown as NoteFields, p.deck);
        } catch (e) {
          if (esFalloDeConexion(e)) return;           // sigue sin red: se reintenta más tarde
          // Ya estaba en Anki: es lo que se quería, cuenta como enviada.
          if (!(e instanceof ServerError && e.duplicate)) {
            await db.pendientes.update(p.id!, { error: e instanceof Error ? e.message : String(e) });
            return;                                   // un error del servidor no se arregla insistiendo
          }
        }
        await db.transaction("rw", db.pendientes, db.added, async () => {
          await db.pendientes.delete(p.id!);
          await db.added.put({ key: p.key, deck: p.deck, at: Date.now() });
        });
      }
    } finally {
      enviando = null;
    }
  })();
  return enviando;
}

/** Las pendientes, vigiladas, y el envío automático mientras quede alguna. */
export function usePendientes(settings: Settings): { pendientes: Pendiente[]; reintentar: () => void; enviandoAhora: boolean } {
  const pendientes = useLiveQuery(() => db.pendientes.orderBy("at").toArray(), []) ?? [];
  const [enviandoAhora, setEnviandoAhora] = useState(false);
  const hay = pendientes.length > 0;

  const reintentar = () => {
    setEnviandoAhora(true);
    enviarPendientes(settings).finally(() => setEnviandoAhora(false));
  };

  useEffect(() => {
    if (!hay) return;
    const intentar = () => { void enviarPendientes(settings); };
    const alVolver = () => { if (document.visibilityState === "visible") intentar(); };
    intentar();
    window.addEventListener("online", intentar);
    document.addEventListener("visibilitychange", alVolver);
    const cada = setInterval(intentar, 60_000);
    return () => {
      window.removeEventListener("online", intentar);
      document.removeEventListener("visibilitychange", alVolver);
      clearInterval(cada);
    };
  }, [hay, settings]);

  return { pendientes, reintentar, enviandoAhora };
}
