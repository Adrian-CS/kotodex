export interface Settings {
  decks: string[];
  lastDeck: string;
  noteType: string;
  profile: string;
  tags: string;
}

const KEY = "jp-dict-settings";
const DEFAULTS: Settings = { decks: ["日本語"], lastDeck: "日本語", noteType: "JP Dict", profile: "", tags: "jp-dict" };

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
