// «Palabras que contienen 食» (和食, 夕食…), no solo las que empiezan por él.
//
// Buscar «contiene» directamente obligaría a recorrer los 530.000 términos de JMdict cada vez. En
// su lugar hay una tabla pequeña: por cada (diccionario, kanji), los ids de sus palabras con más
// score, como mucho MAX_POR_KANJI. Se llena al importar y, para lo ya importado, una sola vez en
// segundo plano (en el worker del importador), sin reimportar nada.

import { db, type KanjiPalabras, type Term } from "./db";

/** Bastan para elegir las 12 que se enseñan, también juntando varios diccionarios. */
export const MAX_POR_KANJI = 150;
/** Lote de lectura al indexar lo ya importado: lo bastante grande para ir rápido en Safari. */
const LOTE = 5000;

const KANJI = /[㐀-䶿一-鿿豈-﫿]/g;

/** Va juntando, por kanji, las palabras con más score sin guardar más de lo necesario en memoria. */
export class AcumuladorKanji {
  private porKanji = new Map<string, { id: number; score: number }[]>();

  anadir(id: number, expression: string, score: number) {
    for (const k of new Set(expression.match(KANJI) ?? [])) {
      let lista = this.porKanji.get(k);
      if (!lista) this.porKanji.set(k, (lista = []));
      lista.push({ id, score });
      // Recortar de vez en cuando: con JMdict serían un millón de entradas en memoria.
      if (lista.length >= MAX_POR_KANJI * 4) this.recortar(lista);
    }
  }

  private recortar(lista: { id: number; score: number }[]) {
    lista.sort((a, b) => b.score - a.score || a.id - b.id);
    lista.length = Math.min(lista.length, MAX_POR_KANJI);
  }

  filas(dict: number): KanjiPalabras[] {
    return [...this.porKanji].map(([kanji, lista]) => {
      this.recortar(lista);
      return { dict, kanji, ids: lista.map(e => e.id) };
    });
  }
}

/** Guarda el índice de un diccionario y lo marca como indexado. */
export async function guardarIndice(dict: number, acumulador: AcumuladorKanji): Promise<void> {
  await db.kanjiPalabras.bulkPut(acumulador.filas(dict));
  await db.dictionaries.update(dict, { kanjiIndexado: true });
}

/** Construye el índice de un diccionario ya importado, leyendo sus términos por lotes. */
export async function indexarDiccionario(dict: number, onProgreso: (hechos: number, total: number) => void): Promise<void> {
  const d = await db.dictionaries.get(dict);
  if (!d) return;
  const acumulador = new AcumuladorKanji();
  // Los términos de un diccionario tienen ids seguidos (bulkAdd): se recorre ese rango por la clave
  // primaria, que es lo más rápido, y se descarta lo que sea de otro diccionario.
  const primero = await db.terms.where("dict").equals(dict).first();
  const ultimo = await db.terms.where("dict").equals(dict).last();
  if (primero && ultimo) {
    let desde = primero.id!;
    let hechos = 0;
    while (desde <= ultimo.id!) {
      const lote: Term[] = await db.terms.where(":id").between(desde, ultimo.id!, true, true).limit(LOTE).toArray();
      if (!lote.length) break;
      for (const t of lote) if (t.dict === dict) acumulador.anadir(t.id!, t.expression, t.score);
      hechos += lote.length;
      onProgreso(Math.min(hechos, d.terms), d.terms);
      desde = lote.at(-1)!.id! + 1;
    }
  }
  await guardarIndice(dict, acumulador);
}

/** Diccionarios de términos que aún no tienen índice: los importados antes de que existiera. */
export async function sinIndice(): Promise<{ id: number; title: string }[]> {
  return (await db.dictionaries.toArray())
    .filter(d => !d.kanjiIndexado && d.terms > 0 && (d.role === "ja" || d.role === "es" || d.role === "en"))
    .map(d => ({ id: d.id!, title: d.title }));
}
