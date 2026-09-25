// Índice de palabras de las definiciones, para poder buscar de inglés o español a japonés.
//
// Es la misma técnica que usa Jisho: un índice de texto sobre los glosarios. La diferencia es que
// aquí vive en el teléfono, dentro del propio IndexedDB, para no perder el funcionamiento sin red.
//
// El tokenizador solo emite palabras en alfabeto latino. Eso lo hace barato por sí solo: un
// diccionario monolingüe japonés no aporta casi nada al índice, así que no hace falta decidir por
// rol qué se indexa y qué no.

/** Palabras vacías: aparecen en casi todos los glosarios y no sirven para buscar. */
const VACIAS = new Set([
  // inglés
  "the", "to", "of", "in", "on", "at", "for", "with", "and", "or", "an", "as", "by", "from",
  "that", "this", "it", "its", "be", "is", "are", "was", "were", "been", "being", "not", "no",
  "esp", "etc", "eg", "ie",
  // español
  "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "que", "se", "del", "al", "por",
  "para", "con", "su", "sus", "lo", "como", "es", "son", "ser", "estar", "sin", "sobre",
]);

const MAX_PALABRAS_POR_TERMINO = 40;

/** Quita tildes y pasa a minúsculas, para que «árbol» y «arbol» sean lo mismo. */
export const normalizar = (texto: string): string =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Texto plano de un glosario de Yomitan (cadenas, {type:"text"} o structured-content). */
function textoPlano(nodo: unknown, salida: string[]): void {
  if (nodo == null) return;
  if (typeof nodo === "string") { salida.push(nodo); return; }
  if (Array.isArray(nodo)) { for (const hijo of nodo) textoPlano(hijo, salida); return; }
  if (typeof nodo !== "object") return;
  const n = nodo as Record<string, unknown>;
  if (typeof n.text === "string") salida.push(n.text);
  if (n.content !== undefined) textoPlano(n.content, salida);
}

/** Cada sentido por separado, en texto plano y normalizado. Sirve para ordenar por relevancia. */
export function glossTexts(glossary: unknown[]): string[] {
  return glossary.map(item => {
    const trozos: string[] = [];
    textoPlano(item, trozos);
    return normalizar(trozos.join(" ")).replace(/\s+/g, " ").trim();
  }).filter(Boolean);
}

/** Palabras indexables de un glosario. Vacío si la definición no lleva alfabeto latino. */
export function indexWords(glossary: unknown[]): string[] {
  const trozos: string[] = [];
  textoPlano(glossary, trozos);
  return tokenizar(trozos.join(" "));
}

/** Divide en palabras latinas, quitando las vacías y las de una sola letra. */
export function tokenizar(texto: string): string[] {
  const encontradas = normalizar(texto).match(/[a-z][a-z'-]*/g);
  if (!encontradas) return [];
  const unicas = new Set<string>();
  for (const palabra of encontradas) {
    const limpia = palabra.replace(/^[-']+|[-']+$/g, "");
    if (limpia.length < 2 || VACIAS.has(limpia)) continue;
    unicas.add(limpia);
    if (unicas.size >= MAX_PALABRAS_POR_TERMINO) break;
  }
  return [...unicas];
}

/** ¿La consulta es una definición (latín) y no una palabra japonesa? */
export const esConsultaLatina = (q: string): boolean =>
  /[a-zA-ZÀ-ÿ]/.test(q) && !/[぀-ヿ㐀-鿿]/.test(q);
