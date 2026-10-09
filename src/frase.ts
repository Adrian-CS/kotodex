// Leer una frase: tocar un carácter y encontrar la palabra que empieza ahí, como Yomitan.
//
// No se parte la frase de antemano (en el iPhone serían segundos al pegarla): solo se trabaja al
// tocar, y solo con el trozo que empieza en ese carácter. Se prueban a la vez todos los cortes
// (行きました, 行きまし, 行きま…) y sus desconjugaciones con consultas exactas en paralelo, y
// gana el corte más largo que exista. La ficha la arma después search() con ese trozo, que ya
// sabe enseñar la conjugación (行きました → 行く · cortés · pasado).

import { db, type Term } from "./db";
import { deinflect, matchesRules, rulesMask, suruStem, VS } from "./deinflect";
import { esKana, porClaves, toHiragana, toKatakana } from "./search";

/** Una palabra japonesa casi nunca pasa de aquí, ni conjugada (食べさせられなかった: 10). */
const MAX_LARGO = 10;
/** Tope de formas desconjugadas que se consultan por toque: cada una es una consulta. */
const MAX_FORMAS = 120;
/** Donde termina cualquier palabra: espacios y puntuación, japonesa y latina. */
const CORTE = /[\s、。，．,.!?！？「」『』（）()［］【】…・〜~"'“”‘’:;：；]/;

/** ¿Merece la pena enseñar el texto como frase tocable? Japonés y algo largo. */
export const esFrase = (texto: string) =>
  /[぀-ヿ一-鿿]/.test(texto) && [...texto.trim()].length >= 5;

/** Frase larga o con puntuación: entonces la búsqueda normal no tiene sentido hasta tocar algo. */
export const soloFrase = (texto: string) =>
  esFrase(texto) && ([...texto.trim()].length > 12 || CORTE.test(texto.trim()));

interface Forma { forma: string; largo: number; rules: number; suru: boolean; reasons: number }

/**
 * Cuántos caracteres ocupa la palabra que empieza en `inicio` (posiciones en caracteres, no en
 * unidades UTF-16), o 0 si ahí no empieza ninguna que esté en los diccionarios activos.
 */
export async function palabraEn(texto: string, inicio: number): Promise<number> {
  const chars = [...texto];
  if (inicio >= chars.length || CORTE.test(chars[inicio])) return 0;
  let fin = inicio;
  while (fin < chars.length && fin - inicio < MAX_LARGO && !CORTE.test(chars[fin])) fin++;

  const activos = new Set((await db.dictionaries.toArray())
    .filter(d => d.enabled && (d.role === "ja" || d.role === "es" || d.role === "en"))
    .map(d => d.id!));
  if (!activos.size) return 0;

  // Todas las formas a consultar, de todos los cortes: la literal (y en hiragana/katakana) y las
  // desconjugadas. Para cada forma se guarda el corte más largo que la produce.
  const formas = new Map<string, Forma>();
  const anadir = (f: Forma) => {
    const previa = formas.get(f.forma);
    if (!previa || f.largo > previa.largo || (f.largo === previa.largo && f.reasons < previa.reasons)) formas.set(f.forma, f);
  };
  const desconjugadas: Forma[] = [];
  for (let largo = fin - inicio; largo >= 1; largo--) {
    const trozo = chars.slice(inicio, inicio + largo).join("");
    for (const f of new Set([trozo, toHiragana(trozo), toKatakana(trozo)])) anadir({ forma: f, largo, rules: 0, suru: false, reasons: 0 });
    if (largo < 2) continue;
    for (const d of deinflect(trozo)) {
      if (!d.reasons.length || d.reasons.length > 5) continue;
      desconjugadas.push({ forma: d.term, largo, rules: d.rules, suru: false, reasons: d.reasons.length });
      const raiz = d.rules & VS ? suruStem(d.term) : null;
      if (raiz) desconjugadas.push({ forma: raiz, largo, rules: d.rules, suru: true, reasons: d.reasons.length });
    }
  }
  // Las desconjugadas de los cortes más largos y con menos pasos primero; el resto no se consulta.
  desconjugadas.sort((a, b) => b.largo - a.largo || a.reasons - b.reasons);
  for (const f of desconjugadas) {
    if (formas.size >= MAX_FORMAS) break;
    anadir(f);
  }

  // Kana por lectura (encuentra también 寿司 tocando すし), lo demás por expresión. Así cada forma
  // es UNA consulta y no dos.
  const todas = [...formas.values()];
  const [porLectura, porExpresion] = await Promise.all([
    porClaves(db.terms, "reading", todas.filter(f => esKana(f.forma)).map(f => f.forma)),
    porClaves(db.terms, "expression", todas.filter(f => !esKana(f.forma)).map(f => f.forma)),
  ]);

  let mejor = 0;
  const comprobar = (t: Term, clave: string) => {
    const f = formas.get(clave);
    if (!f || f.largo <= mejor || !activos.has(t.dict)) return;
    // Una forma desconjugada solo vale si la clase de palabra encaja (como en search.ts).
    if (f.reasons) {
      const reglas = rulesMask(t.rules ?? "");
      if (f.suru ? (reglas & VS) === 0 : !matchesRules(f.rules, reglas)) return;
    }
    mejor = f.largo;
  };
  for (const t of porLectura) comprobar(t, t.reading);
  for (const t of porExpresion) comprobar(t, t.expression);
  return mejor;
}

/** El trozo de la frase entre dos posiciones de carácter. */
export const trozo = (texto: string, inicio: number, largo: number) => [...texto].slice(inicio, inicio + largo).join("");
