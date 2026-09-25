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
  /** Cuántas entradas de pitch trae. Falta en lo importado antes de contarlo. */
  pitches?: number;
  /** Prioridad elegida por el usuario: decide qué definición sale antes. Menor = primero. */
  order?: number;
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
  /** Clases de palabra para el deinflector ("v1", "v5 vt"…). Falta en lo importado antes de tenerlo. */
  rules?: string;
  /** Palabras del glosario, para buscar de inglés/español a japonés. Solo alfabeto latino. */
  words?: string[];
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

/**
 * Una palabra consultada. La clave es la palabra a la que se llegó, no lo que se tecleó: buscar
 * 食べた y 食べる tiene que dejar una sola entrada, no dos.
 */
export interface Lookup {
  key: string;          // entryKey(expression, reading)
  expression: string;
  reading: string;
  /** Lo último que se escribió para llegar aquí. */
  query: string;
  at: number;
  hits: number;
}

class JpDictDB extends Dexie {
  dictionaries!: Table<Dictionary, number>;
  terms!: Table<Term, number>;
  metas!: Table<TermMeta, number>;
  added!: Table<Added, string>;
  lookups!: Table<Lookup, string>;

  constructor() {
    super("jp-dict");
    this.version(1).stores({
      dictionaries: "++id, &title",
      terms: "++id, dict, expression, reading",
      metas: "++id, dict, expression",
      added: "&key",
    });
    // v2 añadió el historial. Los campos nuevos de Dictionary y Term no van indexados,
    // así que no hacen falta migraciones: quedan undefined en lo ya importado.
    this.version(2).stores({
      searches: "&query, at",
    });
    // v3 lo reindexa por palabra en vez de por consulta. Cambiar la clave primaria obliga a
    // recrear la tabla, así que se borra la vieja: el historial previo se pierde y no pasa nada.
    this.version(3).stores({
      searches: null,
      lookups: "&key, at",
    });
    // v4 indexa las palabras de los glosarios (índice multivalor). Los términos ya importados no
    // tienen el campo, así que quedan fuera del índice: hay que reimportar para buscar en ellos.
    this.version(4).stores({
      terms: "++id, dict, expression, reading, *words",
    });
  }
}

export const db = new JpDictDB();

export const entryKey = (expression: string, reading: string) => `${expression}\u0000${reading}`;
