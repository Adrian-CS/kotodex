// Cliente del servidor de Anki (server/). Solo se usa cuando Ajustes está en modo "servidor".
// Los mensajes de error se enseñan tal cual en la UI, así que tienen que decir qué hacer.

import type { NoteFields } from "./anki";
import type { Settings } from "./settings";

export interface ServerHealth {
  status: string;
  notetype: string;
  fields: string[];
  audio: boolean;
  sync: boolean;
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

async function call<T>(s: Settings, path: string, body?: unknown): Promise<T> {
  const url = baseUrl(s);
  if (!url) throw new ServerError("Falta la dirección del servidor en Ajustes.", 0);

  let response: Response;
  try {
    response = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${s.serverToken}`,
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
  return response.json() as Promise<T>;
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
