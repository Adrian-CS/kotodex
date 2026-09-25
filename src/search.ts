import { db, type Dictionary, type Term } from "./db";
import { deinflect, matchesRules, rulesMask, suruStem, VS, type Deinflection } from "./deinflect";
import { esConsultaLatina, esJapones, glossTexts, normalizar, segmentosGlosario, tokenizar } from "./glosses";
import { sensesHtml } from "./structured";

export type DefRole = "ja" | "es" | "en";

export interface DefBlock { dictTitle: string; html: string }

/** Cómo se llegó a la palabra: la forma escrita y las conjugaciones deshechas. */
export interface Inflected { form: string; reasons: string[] }

export interface Entry {
  expression: string;
  reading: string;
  pitches: number[];            // posiciones de downstep (Kanjium/NHK)
  defs: Record<DefRole, DefBlock[]>;
  /** Qué secciones enseñar y en qué orden, según la prioridad de los diccionarios. */
  sections: DefRole[];
  inflected?: Inflected;        // solo si hizo falta deshacer una conjugación
}

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** Hangul: sílabas, jamo modernos y jamo de compatibilidad. */
const esCoreano = (s: string) => /[가-힯ᄀ-ᇿ㄰-㆏]/.test(s);

const MAX_ENTRIES = 20;
/** Huecos reservados a los resultados encontrados por definición en otro idioma. Sin esto, buscar
 *  人 llena la lista con las decenas de entradas japonesas exactas y 사람 no llega a salir. */
const CUOTA_CRUZADA = 5;
/** Tope de términos que se traen de una búsqueda por definición antes de agrupar. */
const MAX_POR_DEFINICION = 500;

export async function search(raw: string): Promise<Entry[]> {
  const q = raw.trim();
  if (!q) return [];

  const dicts = new Map<number, Dictionary>(
    (await db.dictionaries.toArray()).filter(d => d.enabled).map(d => [d.id!, d]));
  const defDict = (t: Term) => {
    const d = dicts.get(t.dict);
    return d && (d.role === "ja" || d.role === "es" || d.role === "en") ? d : undefined;
  };
  const lookup = async (words: string[]): Promise<Term[]> => words.length
    ? (await db.terms.where("expression").anyOf(words).toArray())
        .concat(await db.terms.where("reading").anyOf(words).toArray())
        .filter(defDict)
    : [];

  // Consulta en alfabeto latino: se busca dentro de las definiciones, no por expresión.
  if (esConsultaLatina(q)) {
    const encontrados = (await porDefinicion(q)).filter(defDict);
    return armar(encontrados, dicts, new Set<string>(), new Map(), relevancia(q));
  }

  const variants = [...new Set([q, toHiragana(q), toKatakana(q)])];
  let terms = await lookup(variants);

  // Formas que han dado resultado: sirven para ordenar (coincidencia exacta antes que prefijo).
  const matched = new Set(variants);
  const inflectedByTerm = new Map<number, Inflected>();

  // Coreano: sus reglas y su tabla (105 KB) se cargan solo si hace falta.
  if (!terms.length && esCoreano(q)) {
    const { deinflectKorean, FORMA_DE_DICCIONARIO } = await import("./deinflect-ko");
    const porForma = new Map<string, Inflected>();
    for (const d of deinflectKorean(q)) {
      if (!d.reasons.length) continue;
      // Solo formas de diccionario (verbo, adjetivo, 이다). Sin esto, 갔어요 devuelve 갔 antes que
      // 가다: 갔 existe en el diccionario pero es una terminación intermedia, no una entrada real.
      if ((d.conditions & FORMA_DE_DICCIONARIO) === 0) continue;
      const previo = porForma.get(d.term);
      // De varias formas de llegar a la misma palabra, la explicación más corta.
      if (!previo || d.reasons.length < previo.reasons.length) {
        porForma.set(d.term, { form: q, reasons: d.reasons });
      }
    }
    // Los diccionarios coreanos no traen el campo "rules", así que no hay clase que filtrar:
    // vale con quedarse con los candidatos que existen de verdad en el diccionario.
    for (const t of await lookup([...porForma.keys()])) {
      const mejor = porForma.get(t.expression) ?? porForma.get(t.reading);
      if (!mejor) continue;
      terms.push(t);
      inflectedByTerm.set(t.id!, mejor);
      matched.add(t.expression);
      matched.add(t.reading);
    }
  }

  // Sin coincidencia exacta: deshacer conjugaciones (食べた → 食べる) antes de probar por prefijo.
  if (!terms.length && !esCoreano(q)) {
    // suru: el candidato acaba en する pero se busca el sustantivo suelto (勉強しました → 勉強).
    interface Candidate { form: string; d: Deinflection; suru?: boolean }
    const byTerm = new Map<string, Candidate[]>();
    const add = (term: string, c: Candidate) => {
      const list = byTerm.get(term);
      if (list) list.push(c);
      else byTerm.set(term, [c]);
    };
    for (const form of variants) {
      for (const d of deinflect(form)) {
        if (!d.reasons.length) continue;
        add(d.term, { form, d });
        const stem = d.rules & VS ? suruStem(d.term) : null;
        if (stem) add(stem, { form, d, suru: true });
      }
    }
    for (const t of await lookup([...byTerm.keys()])) {
      const entryRules = rulesMask(t.rules ?? "");
      // De las conjugaciones que llevan a esta palabra, la explicación más corta que sea compatible.
      // Para el sustantivo de un verbo con する se exige "vs": si no, 勉強 casaría con cualquier cosa.
      const best = [...(byTerm.get(t.expression) ?? []), ...(byTerm.get(t.reading) ?? [])]
        .filter(c => c.suru ? (entryRules & VS) !== 0 : matchesRules(c.d.rules, entryRules))
        .sort((a, b) => a.d.reasons.length - b.d.reasons.length)[0];
      if (!best) continue;
      terms.push(t);
      inflectedByTerm.set(t.id!, { form: best.form, reasons: best.d.reasons });
      matched.add(t.expression);
      matched.add(t.reading);
    }
  }

  if (!terms.length) {
    terms = (await db.terms.where("expression").startsWith(q).limit(200).toArray()).filter(defDict);
  }

  // Japonés → otros idiomas. Va SUMADO, no como respaldo: buscar 人 tiene coincidencia exacta en
  // JMdict, así que nunca se llegaría aquí, y lo que se quiere es ver también 사람 debajo.
  const cruzados = new Set<number>();
  if (esJapones(q) && q.length <= 8) {
    const porDefinicionJa = (await porTokens([q])).filter(defDict);
    for (const t of porDefinicionJa) cruzados.add(t.id!);
    terms = terms.concat(porDefinicionJa);
  }

  return armar(terms, dicts, matched, inflectedByTerm, undefined, cruzados, relevanciaJaponesa(q));
}

/**
 * Términos cuyo glosario contiene todas las palabras de la consulta.
 *
 * Se intersecan las listas de cada palabra, así que "train station" solo devuelve lo que lleva las
 * dos. El índice lo construye el importador; los diccionarios importados antes de tenerlo no
 * aparecen aquí hasta que se reimporten.
 */
async function porDefinicion(q: string): Promise<Term[]> {
  return porTokens(tokenizar(q));
}

/** Términos cuyo índice de definición contiene TODOS los tokens dados. */
async function porTokens(tokens: string[]): Promise<Term[]> {
  if (!tokens.length) return [];

  let ids: Set<number> | null = null;
  for (const token of tokens) {
    const claves = (await db.terms.where("words").equals(token).primaryKeys()) as number[];
    if (ids === null) {
      ids = new Set(claves);
    } else {
      const conjunto = new Set(claves);
      const previos: number[] = [...ids];
      ids = new Set(previos.filter(id => conjunto.has(id)));
    }
    if (ids.size === 0) return [];
  }

  const encontrados = await db.terms.bulkGet([...(ids ?? [])].slice(0, MAX_POR_DEFINICION));
  return encontrados.filter((t): t is Term => t !== undefined);
}

/**
 * Cuánto encaja una definición con lo que se buscó, de 0 (mejor) a 3.
 *
 * Sin esto, buscar "bridge" en JMdict devuelve 埋める antes que 橋, porque solo se mira la
 * frecuencia. Lo que interesa es que la palabra buscada SEA la definición, no que aparezca dentro.
 */
/**
 * Relevancia de una entrada encontrada por su definición en japonés.
 *
 * Lo que separa un resultado útil de uno inútil es si la palabra buscada ES uno de los sentidos
 * («水») o solo aparece mencionada dentro de una explicación. Buscar 人 devuelve 129 entradas de
 * Naver; solo cuatro la tienen como equivalente, y entre ellas están 사람 y 인간.
 */
function relevanciaJaponesa(q: string): (t: Term) => number {
  return (t: Term) => {
    let mejor = 3;
    for (const seg of segmentosGlosario(t.glossary)) {
      if (seg === q) return 0;
      if (seg.startsWith(q)) mejor = Math.min(mejor, 1);
      else if (seg.includes(q)) mejor = Math.min(mejor, 2);
    }
    return mejor;
  };
}

function relevancia(q: string): (t: Term) => number {
  const buscado = normalizar(q).replace(/\s+/g, " ").trim();
  return (t: Term) => {
    let mejor = 3;
    for (const sentido of glossTexts(t.glossary)) {
      if (sentido === buscado) return 0;                                  // la definición es justo eso
      if (sentido.startsWith(buscado + " ")) mejor = Math.min(mejor, 1);   // empieza por ahí
      else if (sentido.includes(buscado)) mejor = Math.min(mejor, 2);      // solo lo menciona
    }
    return mejor;
  };
}

/** Agrupa por (expresión, lectura), ordena, añade el pitch y arma las entradas finales. */
async function armar(
  terms: Term[],
  dicts: Map<number, Dictionary>,
  matched: Set<string>,
  inflectedByTerm: Map<number, Inflected>,
  relevanciaDe?: (t: Term) => number,
  cruzados?: Set<number>,
  relevanciaCruzada?: (t: Term) => number,
): Promise<Entry[]> {
  const groups = new Map<string, { expression: string; reading: string; score: number; rel: number; cruzado: boolean; terms: Term[]; inflected?: Inflected }>();
  const seen = new Set<number>();
  for (const t of terms) {
    if (seen.has(t.id!)) continue;
    seen.add(t.id!);
    const key = `${t.expression}\u0000${t.reading}`;
    const g = groups.get(key) ?? { expression: t.expression, reading: t.reading, score: -Infinity, rel: 3, cruzado: false, terms: [] };
    g.score = Math.max(g.score, t.score);
    if (cruzados?.has(t.id!)) {
      g.cruzado = true;
      if (relevanciaCruzada) g.rel = Math.min(g.rel, relevanciaCruzada(t));
    }
    if (relevanciaDe) g.rel = Math.min(g.rel, relevanciaDe(t));
    g.terms.push(t);
    const inflected = inflectedByTerm.get(t.id!);
    if (inflected && (!g.inflected || inflected.reasons.length < g.inflected.reasons.length)) g.inflected = inflected;
    groups.set(key, g);
  }

  const rank = (e: { expression: string; reading: string }) =>
    matched.has(e.expression) ? 0 : matched.has(e.reading) ? 1 : 2;
  type Grupo = ReturnType<typeof groups.get> & object;
  const comparar = (a: Grupo, b: Grupo) =>
    rank(a) - rank(b) || a.rel - b.rel || b.score - a.score || a.expression.length - b.expression.length;

  let sorted: Grupo[];
  const todos = [...groups.values()];
  if (cruzados?.size) {
    // Los encontrados por definición van en su propia lista con hueco garantizado. Ahí una
    // expresión de una sola sílaba (들, 드) casi nunca es la palabra buscada, sino un fragmento,
    // así que se manda al final en vez de premiarla por corta.
    const fragmento = (g: Grupo) => (g.expression.length <= 1 ? 1 : 0);
    const cruce = todos.filter(g => g.cruzado)
      .sort((a, b) => a.rel - b.rel || fragmento(a) - fragmento(b) || b.score - a.score);
    const normales = todos.filter(g => !g.cruzado).sort(comparar);
    sorted = [
      ...normales.slice(0, MAX_ENTRIES - Math.min(CUOTA_CRUZADA, cruce.length)),
      ...cruce.slice(0, CUOTA_CRUZADA),
    ].slice(0, MAX_ENTRIES);
  } else {
    sorted = todos.sort(comparar).slice(0, MAX_ENTRIES);
  }

  // El pitch se coge de cualquier diccionario activo que lo traiga, no solo de los marcados con el
  // rol "pitch": hay diccionarios (NHK, algunos Jitendex) que traen términos y pitch a la vez, y el
  // rol es uno solo. Se busca por expresión y por lectura, porque no todos indexan igual.
  const conPitch = new Set([...dicts.values()].filter(d => d.role !== "other").map(d => d.id!));
  const claves = [...new Set(sorted.flatMap(g => [g.expression, g.reading]))];
  const metas = conPitch.size
    ? (await db.metas.where("expression").anyOf(claves).toArray())
        .filter(m => m.mode === "pitch" && conPitch.has(m.dict))
    : [];

  return sorted.map(g => {
    const byDict = new Map<number, Term[]>();
    for (const t of g.terms) byDict.set(t.dict, [...(byDict.get(t.dict) ?? []), t]);

    // Un bloque por diccionario, ordenados por la prioridad que haya puesto el usuario.
    const bloques: { role: DefRole; dictTitle: string; html: string; order: number }[] = [];
    for (const [dictId, ts] of byDict) {
      const d = dicts.get(dictId)!;
      ts.sort((a, b) => b.score - a.score || a.sequence - b.sequence);
      const html = sensesHtml(ts.map(t => t.glossary));
      if (html) bloques.push({ role: d.role as DefRole, dictTitle: d.title, html, order: d.order ?? dictId });
    }
    bloques.sort((a, b) => a.order - b.order);

    const defs: Record<DefRole, DefBlock[]> = { ja: [], es: [], en: [] };
    for (const b of bloques) defs[b.role].push({ dictTitle: b.dictTitle, html: b.html });
    // Las secciones salen en el orden del primer diccionario de cada una.
    const sections = [...new Set(bloques.map(b => b.role))];

    const lectura = toHiragana(g.reading);
    const pitches = new Set<number>();
    for (const m of metas) {
      if (m.expression !== g.expression && m.expression !== g.reading) continue;
      // Unos guardan la lectura en katakana y otros la omiten cuando la palabra ya es kana.
      const suya = typeof m.data?.reading === "string" ? toHiragana(m.data.reading) : "";
      if (suya && suya !== lectura) continue;
      for (const p of m.data?.pitches ?? []) if (typeof p.position === "number") pitches.add(p.position);
    }
    return { expression: g.expression, reading: g.reading, pitches: [...pitches], defs, sections, inflected: g.inflected };
  });
}
