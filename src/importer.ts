import { unzip } from "fflate";
import { db, type Dictionary, type Role, type Term, type TermMeta } from "./db";
import { indexWords } from "./glosses";

export interface ImportProgress { stage: string; done: number; total: number }

const unzipJson = (buf: Uint8Array) =>
  new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(buf, { filter: f => f.name.endsWith(".json") }, (err, data) => (err ? reject(err) : resolve(data))));

const bankNumber = (name: string) => Number(name.match(/(\d+)\.json$/)?.[1] ?? 0);

function guessRole(title: string, hasTerms: boolean, pitchRows: number): Role {
  if (!hasTerms) return pitchRows > 0 ? "pitch" : "other";
  if (/jmdict|jitendex/i.test(title)) {
    return /(spa|español|espanol|spanish)/i.test(title) ? "es" : "en";
  }
  return "ja";
}

/** Importa un .zip en formato Yomitan (term_bank_*.json y/o term_meta_bank_*.json). */
export async function importDictionary(file: File, onProgress: (p: ImportProgress) => void): Promise<Dictionary> {
  onProgress({ stage: "Descomprimiendo", done: 0, total: 1 });
  const files = await unzipJson(new Uint8Array(await file.arrayBuffer()));
  const decoder = new TextDecoder();

  if (!files["index.json"]) throw new Error(`${file.name} no tiene index.json, así que no es un diccionario de Yomitan.`);
  const index = JSON.parse(decoder.decode(files["index.json"]));
  const title = String(index.title ?? file.name);

  if (await db.dictionaries.where("title").equals(title).count()) {
    throw new Error(`«${title}» ya está importado. Bórralo en la lista si quieres reimportarlo.`);
  }

  const names = Object.keys(files);
  const termBanks = names.filter(n => /^term_bank_\d+\.json$/.test(n)).sort((a, b) => bankNumber(a) - bankNumber(b));
  const metaBanks = names.filter(n => /^term_meta_bank_\d+\.json$/.test(n)).sort((a, b) => bankNumber(a) - bankNumber(b));
  if (!termBanks.length && !metaBanks.length) throw new Error(`«${title}» no contiene términos ni datos de pitch.`);

  // Se añade al final de la lista de prioridad.
  const ordenes = (await db.dictionaries.toArray()).map(d => d.order ?? 0);
  const dictId = await db.dictionaries.add({
    title, revision: String(index.revision ?? ""), role: "other",
    terms: 0, metas: 0, importedAt: Date.now(), enabled: true,
    order: ordenes.length ? Math.max(...ordenes) + 1 : 0,
  });

  const total = termBanks.length + metaBanks.length;
  let done = 0, termCount = 0, metaCount = 0, pitchRows = 0;

  try {
    for (const name of termBanks) {
      onProgress({ stage: `Importando «${title}»`, done, total });
      const rows: any[] = JSON.parse(decoder.decode(files[name]));
      delete files[name]; // liberar memoria cuanto antes
      const terms: Term[] = rows.map(r => {
        const glossary = r[5] ?? [];
        return {
          dict: dictId,
          expression: r[0],
          reading: r[1] || r[0],
          tags: r[2] ?? "",
          rules: r[3] ?? "",
          score: Number(r[4]) || 0,
          glossary,
          sequence: Number(r[6]) || 0,
          // Índice para buscar por definición. En un monolingüe japonés sale vacío y no ocupa.
          words: indexWords(glossary, r[0]),
        };
      });
      await db.terms.bulkAdd(terms);
      termCount += terms.length;
      done++;
    }
    for (const name of metaBanks) {
      onProgress({ stage: `Importando «${title}»`, done, total });
      const rows: any[] = JSON.parse(decoder.decode(files[name]));
      delete files[name];
      const metas: TermMeta[] = rows.map(r => ({ dict: dictId, expression: r[0], mode: r[1], data: r[2] }));
      pitchRows += metas.filter(m => m.mode === "pitch").length;
      await db.metas.bulkAdd(metas);
      metaCount += metas.length;
      done++;
    }
  } catch (e) {
    await deleteDictionary(dictId);
    throw e;
  }

  const role = guessRole(title, termCount > 0, pitchRows);
  await db.dictionaries.update(dictId, { terms: termCount, metas: metaCount, pitches: pitchRows, role });
  navigator.storage?.persist?.().catch(() => {});
  onProgress({ stage: "Listo", done: total, total });
  return (await db.dictionaries.get(dictId))!;
}

const LOTE_BORRADO = 5000;

/**
 * Borra un diccionario.
 *
 * La ficha se quita PRIMERO, para que desaparezca de la lista al instante y la búsqueda deje de
 * verlo; los términos se borran después, por lotes. Con una transacción única, borrar JMdict
 * (284.000 términos) bloquea IndexedDB varios segundos: la lista no se refresca y hasta el
 * interruptor «Activo» de los otros diccionarios se queda esperando.
 *
 * Si se interrumpe a medias quedan términos huérfanos, pero son invisibles: la búsqueda solo mira
 * los de diccionarios que existen y están activos.
 */
export async function deleteDictionary(id: number, onProgress?: (borrados: number) => void) {
  await db.dictionaries.delete(id);

  let borrados = 0;
  for (;;) {
    const claves = await db.terms.where("dict").equals(id).limit(LOTE_BORRADO).primaryKeys();
    if (!claves.length) break;
    await db.terms.bulkDelete(claves as number[]);
    borrados += claves.length;
    onProgress?.(borrados);
  }
  for (;;) {
    const claves = await db.metas.where("dict").equals(id).limit(LOTE_BORRADO).primaryKeys();
    if (!claves.length) break;
    await db.metas.bulkDelete(claves as number[]);
    borrados += claves.length;
    onProgress?.(borrados);
  }
}
