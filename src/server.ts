// Cliente del servidor de Anki (server/). Solo se usa cuando Ajustes está en modo "servidor".
// Los mensajes de error se enseñan tal cual en la UI, así que tienen que decir qué hacer.

import type { NoteFields } from "./anki";
import type { Settings } from "./settings";
import { idiomaDelSistema } from "./i18n";

export interface ServerHealth {
  status: string;
  notetype: string;
  fields: string[];
  audio: boolean;
  sync: boolean;
  autosync?: {
    cada_horas: number;
    proximo_en_minutos: number | null;
    /** Empieza por "error" si la última sincronización automática falló. */
    ultimo_resultado: string;
  };
}

export interface AddedNote {
  note_id: number;
  deck: string;
  audio: string | null;
  duplicate: boolean;
}

export interface EnsureResult {
  created: boolean;
  added_fields: string[];
  warnings: string[];
}

export interface SyncResult {
  required: string;
  server_message: string;
  media: string;
}

/** Error del servidor con el texto que mandó la API; `duplicate` distingue el 409 de nota repetida. */
export class ServerError extends Error {
  constructor(message: string, readonly status: number, readonly duplicate = false) {
    super(message);
    this.name = "ServerError";
  }
}

const baseUrl = (s: Settings) => s.serverUrl.trim().replace(/\/+$/, "");

/** La petición con token e idioma; lanza ServerError con el texto de la API si no va bien. */
async function pedir(s: Settings, path: string, body?: unknown): Promise<Response> {
  const url = baseUrl(s);
  if (!url) throw new ServerError("Falta la dirección del servidor en Ajustes.", 0);

  let response: Response;
  try {
    response = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${s.serverToken}`,
        // Para que los errores del servidor lleguen en el idioma de la interfaz.
        "Accept-Language": s.idioma === "auto" ? idiomaDelSistema() : s.idioma,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ServerError(
      "No se pudo conectar con el servidor. Comprueba la dirección, que el túnel esté levantado " +
        "y que el origen de esta app esté en KOTODEX_CORS_ORIGINS.",
      0,
    );
  }

  if (!response.ok) {
    const detail = await response.json().then(d => d?.detail).catch(() => null);
    const message = typeof detail === "string" ? detail : `El servidor respondió ${response.status}.`;
    throw new ServerError(
      response.status === 401 ? "Token incorrecto: revísalo en Ajustes." : message,
      response.status,
      response.status === 409 && typeof detail === "string" && detail.includes("ya está en la colección"),
    );
  }
  return response;
}

async function call<T>(s: Settings, path: string, body?: unknown): Promise<T> {
  return (await pedir(s, path, body)).json() as Promise<T>;
}

/** Audios ya pedidos en esta sesión, por palabra: volver a darle a ▶ no vuelve a la red. */
const audios = new Map<string, Promise<string>>();

/**
 * URL local (blob:) del audio que llevaría la nota. Es el mismo que adjunta el servidor al
 * añadirla. Un 404 llega como ServerError con status 404: la palabra no tiene audio.
 */
export function audioUrl(s: Settings, expression: string, reading: string, pitchnum: string): Promise<string> {
  const clave = `${expression}\u0000${reading}`;
  let pendiente = audios.get(clave);
  if (!pendiente) {
    pendiente = pedir(s, "/audio", { expression, reading, pitchnum })
      .then(r => r.blob())
      .then(b => URL.createObjectURL(b));
    // Un fallo no se guarda: puede ser la red, y al volver a tocar se reintenta.
    pendiente.catch(() => audios.delete(clave));
    audios.set(clave, pendiente);
  }
  return pendiente;
}

export const health = (s: Settings) => call<ServerHealth>(s, "/health");

export const listDecks = (s: Settings) =>
  call<{ decks: string[]; default: string }>(s, "/decks");

export const ensureNotetype = (s: Settings) =>
  call<EnsureResult>(s, "/notetype/ensure", { force: false });

// wait_media: false — la media sigue subiendo en segundo plano. Con una colección grande,
// esperarla deja el botón de Ajustes colgado varios minutos sin decir nada.
export const sync = (s: Settings) => call<SyncResult>(s, "/sync", { wait_media: false });

export interface WordCheck {
  expression: string;
  reading: string;
  /** Notas que ya tienen la palabra. */
  notes: number;
  /** De esas, cuántas ya están en estudio (no son tarjetas nuevas sin ver). */
  studied: number;
}

/** Cuántas notas hay ya en la colección con cada palabra (cualquier tipo de nota). */
export const checkNotes = (s: Settings, words: { expression: string; reading: string }[]) =>
  call<{ results: WordCheck[] }>(s, "/notes/check", { words });

export function addNote(
  s: Settings,
  fields: NoteFields,
  deck: string,
  options: { allowDuplicate?: boolean } = {},
): Promise<AddedNote> {
  return call<AddedNote>(s, "/notes", {
    fields,
    deck,
    tags: s.tags.split(" ").filter(Boolean),
    allow_duplicate: options.allowDuplicate ?? false,
  });
}
