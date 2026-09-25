import Dexie, { type Table } from "dexie";

/** Qué papel tiene cada diccionario en la tarjeta. "other" = importado pero ignorado. */
export type Role = "ja" | "es" | "en" | "pitch" | "other";

export interface Dictionary {
  id?: number;
  title: string;
  revision: string;
  role: Role;
  terms: number;
  metas: number;
  importedAt: number;
  enabled: boolean;
}

/** Fila de term_bank de Yomitan (v3). */
export interface Term {
  id?: number;
  dict: number;
  expression: string;
  reading: string;
  glossary: unknown[];
  tags: string;
  score: number;
  sequence: number;
}

/** Fila de term_meta_bank (pitch, freq…). */
export interface TermMeta {
  id?: number;
  dict: number;
  expression: string;
  mode: string;
  data: any;
}

export interface Added {
  key: string; // expression + reading
  deck: string;
  at: number;
}

class JpDictDB extends Dexie {
  dictionaries!: Table<Dictionary, number>;
  terms!: Table<Term, number>;
  metas!: Table<TermMeta, number>;
  added!: Table<Added, string>;

  constructor() {
    super("jp-dict");
    this.version(1).stores({
      dictionaries: "++id, &title",
      terms: "++id, dict, expression, reading",
      metas: "++id, dict, expression",
      added: "&key",
    });
  }
}

export const db = new JpDictDB();

export const entryKey = (expression: string, reading: string) => `${expression}\u0000${reading}`;
