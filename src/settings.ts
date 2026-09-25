import type { Idioma } from "./i18n";

/** Cómo se añaden las tarjetas: abriendo AnkiMobile o mandándolas al servidor propio. */
export type AnkiMode = "ankimobile" | "server";

export interface Settings {
  decks: string[];
  lastDeck: string;
  noteType: string;
  profile: string;
  tags: string;
  mode: AnkiMode;
  serverUrl: string;
  serverToken: string;
  /** "auto" = el del sistema. */
  idioma: Idioma | "auto";
}

const KEY = "jp-dict-settings";
const DEFAULTS: Settings = {
  decks: ["日本語"],
  lastDeck: "日本語",
  noteType: "JP Dict",
  profile: "",
  tags: "jp-dict",
  mode: "ankimobile",
  serverUrl: "",
  serverToken: "",
  idioma: "auto",
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento: se usan los valores en memoria */ }
}
