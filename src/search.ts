import { db, type Dictionary, type Term } from "./db";
import { deinflect, matchesRules, rulesMask, suruStem, VS, type Deinflection } from "./deinflect";
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
  inflected?: Inflected;        // solo si hizo falta deshacer una conjugación
}

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

const MAX_ENTRIES = 20;

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

  const variants = [...new Set([q, toHiragana(q), toKatakana(q)])];
  let terms = await lookup(variants);

  // Formas que han dado resultado: sirven para ordenar (coincidencia exacta antes que prefijo).
  const matched = new Set(variants);
  const inflectedByTerm = new Map<number, Inflected>();

  // Sin coincidencia exacta: deshacer conjugaciones (食べた → 食べる) antes de probar por prefijo.
  if (!terms.length) {
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

  // Agrupar por (expresión, lectura): cada diccionario aporta sus sentidos.
  const groups = new Map<string, { expression: string; reading: string; score: number; terms: Term[]; inflected?: Inflected }>();
  const seen = new Set<number>();
  for (const t of terms) {
    if (seen.has(t.id!)) continue;
    seen.add(t.id!);
    const key = `${t.expression}\u0000${t.reading}`;
    const g = groups.get(key) ?? { expression: t.expression, reading: t.reading, score: -Infinity, terms: [] };
    g.score = Math.max(g.score, t.score);
    g.terms.push(t);
    const inflected = inflectedByTerm.get(t.id!);
    if (inflected && (!g.inflected || inflected.reasons.length < g.inflected.reasons.length)) g.inflected = inflected;
    groups.set(key, g);
  }

  const rank = (e: { expression: string; reading: string }) =>
    matched.has(e.expression) ? 0 : matched.has(e.reading) ? 1 : 2;
  const sorted = [...groups.values()]
    .sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.expression.length - b.expression.length)
    .slice(0, MAX_ENTRIES);

  const pitchDicts = new Set([...dicts.values()].filter(d => d.role === "pitch").map(d => d.id!));
  const metas = pitchDicts.size
    ? (await db.metas.where("expression").anyOf([...new Set(sorted.map(g => g.expression))]).toArray())
        .filter(m => m.mode === "pitch" && pitchDicts.has(m.dict))
    : [];

  return sorted.map(g => {
    const defs: Record<DefRole, DefBlock[]> = { ja: [], es: [], en: [] };
    const byDict = new Map<number, Term[]>();
    for (const t of g.terms) byDict.set(t.dict, [...(byDict.get(t.dict) ?? []), t]);
    for (const [dictId, ts] of byDict) {
      const d = dicts.get(dictId)!;
      ts.sort((a, b) => b.score - a.score || a.sequence - b.sequence);
      const html = sensesHtml(ts.map(t => t.glossary));
      if (html) defs[d.role as DefRole].push({ dictTitle: d.title, html });
    }

    const pitches = new Set<number>();
    for (const m of metas) {
      if (m.expression !== g.expression || m.data?.reading !== g.reading) continue;
      for (const p of m.data.pitches ?? []) if (typeof p.position === "number") pitches.add(p.position);
    }
    return { expression: g.expression, reading: g.reading, pitches: [...pitches], defs, inflected: g.inflected };
  });
}
