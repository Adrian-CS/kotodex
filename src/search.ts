import { db, type Dictionary, type Term } from "./db";
import { sensesHtml } from "./structured";

export type DefRole = "ja" | "es" | "en";

export interface DefBlock { dictTitle: string; html: string }

export interface Entry {
  expression: string;
  reading: string;
  pitches: number[];            // posiciones de downstep (Kanjium/NHK)
  defs: Record<DefRole, DefBlock[]>;
}

const toHiragana = (s: string) => s.replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKatakana = (s: string) => s.replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

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

  const variants = [...new Set([q, toHiragana(q), toKatakana(q)])];
  let terms = (await db.terms.where("expression").anyOf(variants).toArray())
    .concat(await db.terms.where("reading").anyOf(variants).toArray())
    .filter(defDict);
  const exact = terms.length > 0;
  if (!exact) {
    terms = (await db.terms.where("expression").startsWith(q).limit(200).toArray()).filter(defDict);
  }

  // Agrupar por (expresión, lectura): cada diccionario aporta sus sentidos.
  const groups = new Map<string, { expression: string; reading: string; score: number; terms: Term[] }>();
  const seen = new Set<number>();
  for (const t of terms) {
    if (seen.has(t.id!)) continue;
    seen.add(t.id!);
    const key = `${t.expression}\u0000${t.reading}`;
    const g = groups.get(key) ?? { expression: t.expression, reading: t.reading, score: -Infinity, terms: [] };
    g.score = Math.max(g.score, t.score);
    g.terms.push(t);
    groups.set(key, g);
  }

  const rank = (e: { expression: string; reading: string }) =>
    variants.includes(e.expression) ? 0 : variants.includes(e.reading) ? 1 : 2;
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
    return { expression: g.expression, reading: g.reading, pitches: [...pitches], defs };
  });
}
