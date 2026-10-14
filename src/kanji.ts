// Ficha de un kanji: lecturas, significados, trazos, grado… sacados de los diccionarios de kanji
// de Yomitan (KANJIDIC), más las palabras que empiezan por él en los diccionarios de términos.

import { db, type Dictionary, type Term } from "./db";
import { segmentosGlosario } from "./glosses";
import { anotarFrecuenciasActivas } from "./search";

/** Kanji (CJK unificados y extensión A) y el símbolo de repetición 々 no cuenta: no tiene ficha. */
export const esKanji = (c: string) => /[㐀-䶿一-鿿豈-﫿]/.test(c);

export interface Significados { dictTitle: string; meanings: string[] }

export interface FichaKanji {
  character: string;
  onyomi: string[];
  kunyomi: string[];
  /** Uno por diccionario de kanji activo, en el orden de prioridad del usuario. */
  significados: Significados[];
  strokes?: number;
  grade?: number;
  /** Nivel del JLPT actual, N5 = 5 … N1 = 1, según las listas de Waller (ver jlpt.ts). */
  jlptN?: number;
  /** Nivel del JLPT ANTIGUO (1–4) que trae KANJIDIC; solo se enseña si el actual no se conoce. */
  jlpt?: number;
  /** Puesto entre los 2.500 kanji más frecuentes en prensa. */
  freq?: number;
}

export interface PalabraConKanji { expression: string; reading: string; gloss: string }

const numero = (v: string | undefined) => {
  const n = Number(v);
  return v && Number.isFinite(n) ? n : undefined;
};

/** Diccionarios activos ordenados por prioridad. */
async function activos(): Promise<Dictionary[]> {
  return (await db.dictionaries.toArray())
    .filter(d => d.enabled)
    .sort((a, b) => (a.order ?? a.id!) - (b.order ?? b.id!));
}

/** ¿Hay algún diccionario de kanji activo? Sin él no tiene sentido ofrecer la ficha. */
export async function hayDiccionarioKanji(): Promise<boolean> {
  return (await activos()).some(d => d.role !== "other" && (d.kanji ?? 0) > 0);
}

/** La ficha del kanji, o null si ningún diccionario activo lo trae. */
export async function fichaKanji(character: string): Promise<FichaKanji | null> {
  const dicts = (await activos()).filter(d => d.role !== "other");
  const orden = new Map(dicts.map((d, i) => [d.id!, i]));
  const filas = (await db.kanji.where("character").equals(character).toArray())
    .filter(k => orden.has(k.dict))
    .sort((a, b) => orden.get(a.dict)! - orden.get(b.dict)!);
  if (!filas.length) return null;

  // Las lecturas y los datos son los mismos en KANJIDIC inglés y español; solo cambian los
  // significados. Se juntan sin repetir, y los datos se cogen del primero que los traiga.
  const unir = (campo: "onyomi" | "kunyomi") =>
    [...new Set(filas.flatMap(k => k[campo].split(/\s+/).filter(Boolean)))];
  const dato = (clave: string) => numero(filas.find(k => k.stats?.[clave])?.stats[clave]);
  const titulo = new Map(dicts.map(d => [d.id!, d.title]));
  const { nivelJlpt } = await import("./jlpt");

  return {
    character,
    onyomi: unir("onyomi"),
    kunyomi: unir("kunyomi"),
    significados: filas
      .filter(k => k.meanings.length)
      .map(k => ({ dictTitle: titulo.get(k.dict) ?? "", meanings: k.meanings })),
    strokes: dato("strokes"),
    grade: dato("grade"),
    jlptN: nivelJlpt(character),
    jlpt: dato("jlpt"),
    freq: dato("freq"),
  };
}

/** Cuántas filas se miran antes de ordenar: las que empiezan por el kanji, en orden de índice. */
const MAX_FILAS_PALABRAS = 300;
/** Cuántas candidatas reciben frecuencia (una consulta por palabra, en paralelo). */
const MAX_CON_FRECUENCIA_KANJI = 200;

/**
 * Palabras con el kanji, las más frecuentes primero.
 *
 * Las que lo contienen salen del índice de indiceKanji.ts; mientras no esté, solo las que empiezan
 * por él, que es un rango del índice de expresiones y va directo.
 */
export async function palabrasConKanji(character: string, max = 12): Promise<{ palabras: PalabraConKanji[]; contiene: boolean }> {
  const dicts = (await activos()).filter(d => d.role === "ja" || d.role === "es" || d.role === "en");
  const orden = new Map(dicts.map((d, i) => [d.id!, i]));
  // Con el índice de indiceKanji.ts, las que lo CONTIENEN (和食, 夕食); si algún diccionario aún no
  // lo tiene (se está construyendo), las que empiezan por él, que es un rango del índice normal.
  const contiene = dicts.length > 0 && dicts.every(d => d.kanjiIndexado);
  // Las que empiezan por él van siempre (un rango del índice, rápido): así una palabra muy común
  // que JMdict no marca como común (今日 para 今) no se queda fuera de las 150 del índice.
  const [delIndice, empiezan] = await Promise.all([
    contiene
      ? db.kanjiPalabras.bulkGet(dicts.map(d => [d.id!, character] as [number, string]))
        .then(filas => db.terms.bulkGet(filas.flatMap(f => f?.ids ?? [])))
        .then(ts => ts.filter((t): t is Term => t !== undefined))
      : Promise.resolve([] as Term[]),
    db.terms.where("expression").startsWith(character).limit(MAX_FILAS_PALABRAS).toArray(),
  ]);
  const filas = [...delIndice, ...empiezan].filter(t => orden.has(t.dict) && t.expression !== character);

  // Una entrada por (palabra, lectura): la del diccionario con más prioridad da la definición.
  type Grupo = { t: Term; expression: string; reading: string; score: number; frec: number };
  const grupos = new Map<string, Grupo>();
  for (const t of filas) {
    const clave = `${t.expression}\u0000${t.reading}`;
    const previo = grupos.get(clave);
    if (!previo) grupos.set(clave, { t, expression: t.expression, reading: t.reading, score: t.score, frec: Infinity });
    else {
      previo.score = Math.max(previo.score, t.score);
      if (orden.get(t.dict)! < orden.get(previo.t.dict)!) previo.t = t;
    }
  }
  // Orden: frecuencia (JPDB…) si hay diccionario de frecuencia, y si no el score de JMdict, que
  // empata entre cientos de palabras comunes (飲食, 会食 y 食事 valen lo mismo).
  const porScore = (a: Grupo, b: Grupo) => b.score - a.score || a.expression.length - b.expression.length;
  await anotarFrecuenciasActivas([...grupos.values()], porScore, MAX_CON_FRECUENCIA_KANJI);
  const palabras = [...grupos.values()]
    .sort((a, b) => a.frec - b.frec || porScore(a, b))
    .slice(0, max)
    .map(({ t }) => ({
      expression: t.expression,
      reading: t.reading,
      gloss: sentidosCortos(t.glossary).slice(0, 3).join("; "),
    }));
  return { palabras, contiene };
}

/** Texto plano de un nodo de structured-content. */
function texto(nodo: unknown): string {
  if (nodo == null) return "";
  if (typeof nodo === "string") return nodo;
  if (Array.isArray(nodo)) return nodo.map(texto).join("");
  if (typeof nodo !== "object") return "";
  const n = nodo as Record<string, unknown>;
  return (typeof n.text === "string" ? n.text : "") + texto(n.content);
}

/**
 * Los equivalentes sueltos de un glosario: «winning over», «placation»… para la lista de palabras.
 *
 * JMdict (jmdict-yomitan) los trae como <li> dentro de una <ul data-content="glossary">, junto a
 * notas y referencias cruzadas que aquí sobran. Aplanarlo todo los pegaba con espacios («winning
 * over placation gentle persuasion»). Sin esa lista, vale el corte por separadores de siempre.
 */
function sentidosCortos(glossary: unknown[]): string[] {
  const salida: string[] = [];
  const recorrer = (nodo: unknown, dentroDeGlosario: boolean) => {
    if (nodo == null || typeof nodo !== "object") return;
    if (Array.isArray(nodo)) { for (const hijo of nodo) recorrer(hijo, dentroDeGlosario); return; }
    const n = nodo as Record<string, unknown>;
    const esGlosario = dentroDeGlosario || (n.data as Record<string, unknown> | undefined)?.content === "glossary";
    if (esGlosario && n.tag === "li") {
      const t = texto(n.content).trim();
      if (t) salida.push(t);
      return;
    }
    recorrer(n.content, esGlosario);
  };
  recorrer(glossary, false);
  return salida.length ? salida : segmentosGlosario(glossary);
}

/** なつ.かしい → ["なつ", "かしい"]: la raíz y el okurigana, para enseñarlo atenuado. */
export function partirOkurigana(lectura: string): [string, string] {
  const punto = lectura.indexOf(".");
  return punto < 0 ? [lectura, ""] : [lectura.slice(0, punto), lectura.slice(punto + 1)];
}
