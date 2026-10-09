// Copia de seguridad de lo que no se puede reconstruir importando diccionarios: historial,
// palabras añadidas, ajustes y preferencias de cada diccionario (rol, orden, activo).
//
// iOS puede borrar los datos de una app web que lleva tiempo sin abrirse. Los diccionarios se
// reimportan desde los .zip; esto no. La copia automática va al servidor (una web no puede guardar
// archivos por su cuenta, y guardarla aquí mismo se borraría con todo lo demás); la manual es un
// archivo que se guarda donde se quiera.

import { db, type Added, type Lookup, type Role } from "./db";
import type { Settings } from "./settings";
import { guardarCopia, ultimaCopia } from "./server";

export interface Copia {
  app: "kotodex";
  version: 1;
  creada: string;
  /** Sin el token del servidor: un archivo de copia no debería servir para entrar en él. */
  ajustes: Omit<Settings, "serverToken">;
  historial: Lookup[];
  añadidas: Added[];
  /** Por título, porque los id cambian al reimportar. */
  diccionarios: { title: string; role: Role; enabled: boolean; order?: number }[];
}

export async function crearCopia(settings: Settings): Promise<Copia> {
  const { serverToken: _token, ...ajustes } = settings;
  const [historial, añadidas, dicts] = await Promise.all([
    db.lookups.toArray(), db.added.toArray(), db.dictionaries.toArray(),
  ]);
  return {
    app: "kotodex",
    version: 1,
    creada: new Date().toISOString(),
    ajustes,
    historial,
    añadidas,
    diccionarios: dicts.map(d => ({ title: d.title, role: d.role, enabled: d.enabled, order: d.order })),
  };
}

export interface Restaurado { historial: number; añadidas: number; diccionarios: number }

/**
 * Mezcla la copia con lo que hay, sin borrar nada: lo de la copia se añade y, si choca, gana lo
 * más reciente. Los ajustes conservan la dirección y el token del servidor de este dispositivo.
 * Las preferencias de diccionario solo se aplican a los que ya estén importados (por título).
 */
export async function restaurarCopia(
  copia: Copia,
  settings: Settings,
  setSettings: (s: Settings) => void,
): Promise<Restaurado> {
  if (copia?.app !== "kotodex" || copia.version !== 1) throw new Error("copia");
  let historial = 0, añadidas = 0, diccionarios = 0;
  await db.transaction("rw", db.lookups, db.added, db.dictionaries, async () => {
    for (const l of copia.historial ?? []) {
      const actual = await db.lookups.get(l.key);
      if (!actual || actual.at < l.at) { await db.lookups.put(l); historial++; }
    }
    for (const a of copia.añadidas ?? []) {
      const actual = await db.added.get(a.key);
      if (!actual || actual.at < a.at) { await db.added.put(a); añadidas++; }
    }
    for (const d of copia.diccionarios ?? []) {
      const local = await db.dictionaries.where("title").equals(d.title).first();
      if (!local) continue;
      await db.dictionaries.update(local.id!, { role: d.role, enabled: d.enabled, order: d.order });
      diccionarios++;
    }
  });
  setSettings({ ...settings, ...copia.ajustes, serverUrl: settings.serverUrl, serverToken: settings.serverToken });
  return { historial, añadidas, diccionarios };
}

/** Guarda la copia como archivo: hoja de compartir en el iPhone («Guardar en Archivos»), descarga si no. */
export async function exportarArchivo(settings: Settings): Promise<void> {
  const copia = await crearCopia(settings);
  const nombre = `kotodex-${copia.creada.slice(0, 10)}.json`;
  const archivo = new File([JSON.stringify(copia)], nombre, { type: "application/json" });
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: nombre });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;   // cancelado por el usuario
    }
  }
  const url = URL.createObjectURL(archivo);
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function leerArchivo(file: File): Promise<Copia> {
  return JSON.parse(await file.text()) as Copia;
}

// ---- automática -------------------------------------------------------------------------------

const CLAVE_ULTIMA = "kotodex-ultima-copia";
/** Cada cuánto se manda la copia automática al servidor. */
export const CADA_MS = 24 * 60 * 60 * 1000;

export function ultimaCopiaAutomatica(): number | null {
  try { return Number(localStorage.getItem(CLAVE_ULTIMA)) || null; } catch { return null; }
}

const servidorListo = (s: Settings) => s.mode === "server" && !!s.serverUrl && !!s.serverToken;

/** Manda la copia al servidor ahora. Devuelve la fecha de la copia. */
export async function copiarAlServidor(settings: Settings): Promise<number> {
  await guardarCopia(settings, await crearCopia(settings));
  const ahora = Date.now();
  try { localStorage.setItem(CLAVE_ULTIMA, String(ahora)); } catch { /* sin almacenamiento */ }
  return ahora;
}

/**
 * Se llama al abrir la app y al volver a ella: si toca (más de CADA_MS desde la última) y hay
 * servidor, se manda la copia. Sin red o sin servidor no pasa nada; se reintenta la próxima vez.
 */
export async function copiaAutomaticaSiToca(settings: Settings): Promise<void> {
  if (!servidorListo(settings) || settings.copiaAutomatica === false) return;
  const ultima = ultimaCopiaAutomatica();
  if (ultima && Date.now() - ultima < CADA_MS) return;
  await copiarAlServidor(settings).catch(() => { /* se reintenta al volver a abrir */ });
}

export const restaurarDelServidor = async (settings: Settings, setSettings: (s: Settings) => void) =>
  restaurarCopia(await ultimaCopia(settings) as Copia, settings, setSettings);
