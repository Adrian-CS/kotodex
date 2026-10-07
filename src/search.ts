import { db, type Dictionary, type Term } from "./db";
import { deinflect, matchesRules, rulesMask, suruStem, VS, type Deinflection } from "./deinflect";
import { esConsultaLatina, esJapones, glossTexts, normalizar, segmentosGlosario, tokenizar } from "./glosses";
import { candidatosCoreanos, candidatosJaponeses } from "./romanizacion";
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
/** Huecos garantizados a cada diccionario cuando se busca por definición. */
const MIN_POR_DICCIONARIO = 3;
/**
 * Tope de términos que se traen de una búsqueda por definición antes de ordenar por relevancia.
 *
 * Tiene que ser holgado: las claves llegan ordenadas por id, o sea por orden de importación, y
 * cortar pronto se queda con las palabras alfabéticamente tempranas del diccionario. Con 500,
 * buscar 人 no llegaba a ver 사람.
 */
const MAX_POR_DEFINICION = 4000;

/** Cuánto tardó cada fase de una búsqueda, en ms. Las fases en paralelo se solapan. */
export interface Tiempos { total: number; fases: [string, number][] }

/** La búsqueda dejó de interesar (el usuario siguió escribiendo): se abandona sin resultado. */
export class BusquedaCancelada extends Error {}

export interface OpcionesBusqueda {
  /** Se consulta entre fases; si devuelve false, la búsqueda se abandona con BusquedaCancelada. */
  vigente?: () => boolean;
  alMedir?: (t: Tiempos) => void;
}

/**
 * @param soloDiccionario Título de un diccionario para buscar solo en él. El pitch sigue saliendo
 *   de todos: filtrar por definiciones no debería quitar el gráfico de acentos.
 */
export async function search(raw: string, soloDiccionario?: string | null, opciones: OpcionesBusqueda = {}): Promise<Entry[]> {
  const q = raw.trim();
  if (!q) return [];

  // Cancelar entre fases importa en el iPhone: al escribir «kaiseki» letra a letra salen varias
  // búsquedas intermedias, y si no se abandonan la última espera en cola detrás de ellas.
  const inicio = performance.now();
  const fases = new Map<string, number>();
  const fase = async <T>(nombre: string, trabajo: Promise<T>): Promise<T> => {
    const t = performance.now();
    const r = await trabajo;
    fases.set(nombre, (fases.get(nombre) ?? 0) + performance.now() - t);
    if (opciones.vigente && !opciones.vigente()) throw new BusquedaCancelada();
    return r;
  };
  const terminar = (entradas: Entry[]): Entry[] => {
    opciones.alMedir?.({ total: performance.now() - inicio, fases: [...fases] });
    return entradas;
  };

  const dicts = new Map<number, Dictionary>(
    (await fase("diccionarios", db.dictionaries.toArray())).filter(d => d.enabled).map(d => [d.id!, d]));
  const defDict = (t: Term) => {
    const d = dicts.get(t.dict);
    if (!d || (soloDiccionario && d.title !== soloDiccionario)) return undefined;
    return d.role === "ja" || d.role === "es" || d.role === "en" ? d : undefined;
  };
  // Expresión y lectura a la vez: en Safari cada consulta a IndexedDB tiene una latencia fija
  // apreciable, y en serie se suman.
  const lookup = async (words: string[]): Promise<Term[]> => {
    if (!words.length) return [];
    const [porExpresion, porLectura] = await Promise.all([
      db.terms.where("expression").anyOf(words).toArray(),
      db.terms.where("reading").anyOf(words).toArray(),
    ]);
    return porExpresion.concat(porLectura).filter(defDict);
  };
  // Solo por lectura, para candidatos en kana o hangul: el importador rellena `reading` con la
  // expresión cuando no trae otra, así que mirar también `expression` no encuentra nada nuevo y
  // en Safari duplica el coste (en la búsqueda romanizada era la fase más lenta).
  const lookupLectura = async (words: string[]): Promise<Term[]> => words.length
    ? (await db.terms.where("reading").anyOf(words).toArray()).filter(defDict)
    : [];

  /**
   * Formas de diccionario coreanas a las que se llega deshaciendo la conjugación de `formas`.
   * Sus reglas y su tabla (105 KB) se cargan solo si hace falta.
   */
  const deshacerCoreano: Deshacer = async (formas, destino, matched, inflectedByTerm, mostrar, soloLectura) => {
    const { deinflectKorean, FORMA_DE_DICCIONARIO } = await fase("cargar coreano", import("./deinflect-ko"));
    const porForma = new Map<string, Inflected>();
    for (const forma of formas) {
      for (const d of deinflectKorean(forma)) {
        if (!d.reasons.length) continue;
        // Solo formas de diccionario (verbo, adjetivo, 이다). Sin esto, 갔어요 devuelve 갔 antes que
        // 가다: 갔 existe en el diccionario pero es una terminación intermedia, no una entrada real.
        if ((d.conditions & FORMA_DE_DICCIONARIO) === 0) continue;
        const previo = porForma.get(d.term);
        // De varias formas de llegar a la misma palabra, la explicación más corta.
        if (!previo || d.reasons.length < previo.reasons.length) {
          porForma.set(d.term, { form: mostrar ?? forma, reasons: d.reasons });
        }
      }
    }
    // Los diccionarios coreanos no traen el campo "rules", así que no hay clase que filtrar:
    // vale con quedarse con los candidatos que existen de verdad en el diccionario.
    for (const t of await fase("conjugaciones ko", (soloLectura ? lookupLectura : lookup)([...porForma.keys()]))) {
      const mejor = porForma.get(t.expression) ?? porForma.get(t.reading);
      if (!mejor) continue;
      destino.push(t);
      inflectedByTerm.set(t.id!, mejor);
      matched.add(t.expression);
      matched.add(t.reading);
    }
  };

  /** Lo mismo en japonés: 食べた → 食べる, 勉強しました → 勉強. */
  const deshacerJapones: Deshacer = async (formas, destino, matched, inflectedByTerm, _mostrar, soloLectura) => {
    // suru: el candidato acaba en する pero se busca el sustantivo suelto (勉強しました → 勉強).
    interface Candidate { form: string; d: Deinflection; suru?: boolean }
    const byTerm = new Map<string, Candidate[]>();
    const add = (term: string, c: Candidate) => {
      const list = byTerm.get(term);
      if (list) list.push(c);
      else byTerm.set(term, [c]);
    };
    for (const form of formas) {
      for (const d of deinflect(form)) {
        if (!d.reasons.length) continue;
        add(d.term, { form, d });
        const stem = d.rules & VS ? suruStem(d.term) : null;
        if (stem) add(stem, { form, d, suru: true });
      }
    }
    for (const t of await fase("conjugaciones ja", (soloLectura ? lookupLectura : lookup)([...byTerm.keys()]))) {
      const entryRules = rulesMask(t.rules ?? "");
      // De las conjugaciones que llevan a esta palabra, la explicación más corta que sea compatible.
      // Para el sustantivo de un verbo con する se exige "vs": si no, 勉強 casaría con cualquier cosa.
      const best = [...(byTerm.get(t.expression) ?? []), ...(byTerm.get(t.reading) ?? [])]
        .filter(c => c.suru ? (entryRules & VS) !== 0 : matchesRules(c.d.rules, entryRules))
        .sort((a, b) => a.d.reasons.length - b.d.reasons.length)[0];
      if (!best) continue;
      destino.push(t);
      inflectedByTerm.set(t.id!, { form: best.form, reasons: best.d.reasons });
      matched.add(t.expression);
      matched.add(t.reading);
    }
  };

  // Consulta en alfabeto latino: se busca dentro de las definiciones y, si se puede leer como
  // rōmaji o como coreano romanizado, también por lectura (kaiseki → 懐石, sarang → 사랑).
  if (esConsultaLatina(q)) {
    // Las dos búsquedas a la vez: en serie, kaiseki tardaba el triple que una búsqueda en kanji.
    const [encontrados, porLectura] = await Promise.all([
      fase("definiciones", porDefinicion(q)).then(ts => ts.filter(defDict)),
      fase("lectura", porRomanizacion(q, lookupLectura, deshacerJapones, deshacerCoreano, dicts, fase)),
    ]);
    const porDef = encontrados.length
      ? await fase("armar", armar(encontrados, dicts, new Set<string>(), new Map(), relevancia(q), undefined, undefined, true))
      : [];
    if (!porLectura.length) return terminar(porDef);
    if (!porDef.length) return terminar(porLectura);
    // Las dos listas a la vez: «sake» es una palabra inglesa y también 酒. Va primero la de
    // definiciones solo si alguna la tiene como equivalente exacto («bridge» → 橋); si no, la
    // consulta casi seguro era una lectura.
    const rel = relevancia(q);
    const definicionPrimero = encontrados.some(t => rel(t) === 0);
    return terminar(juntar(definicionPrimero ? porDef : porLectura, definicionPrimero ? porLectura : porDef));
  }

  const variants = [...new Set([q, toHiragana(q), toKatakana(q)])];
  let terms = await fase("exacta", lookup(variants));

  // Formas que han dado resultado: sirven para ordenar (coincidencia exacta antes que prefijo).
  const matched = new Set(variants);
  const inflectedByTerm = new Map<number, Inflected>();

  if (!terms.length && esCoreano(q)) await deshacerCoreano([q], terms, matched, inflectedByTerm);

  // Sin coincidencia exacta: deshacer conjugaciones (食べた → 食べる) antes de probar por prefijo.
  if (!terms.length && !esCoreano(q)) await deshacerJapones(variants, terms, matched, inflectedByTerm);

  if (!terms.length) {
    terms = (await fase("prefijo", db.terms.where("expression").startsWith(q).limit(200).toArray())).filter(defDict);
  }

  // Japonés → otros idiomas. Va SUMADO, no como respaldo: buscar 人 tiene coincidencia exacta en
  // JMdict, así que nunca se llegaría aquí, y lo que se quiere es ver también 사람 debajo.
  const cruzados = new Set<number>();
  if (esJapones(q) && q.length <= 8) {
    const porDefinicionJa = (await fase("cruzada", porTokens([q]))).filter(defDict);
    for (const t of porDefinicionJa) cruzados.add(t.id!);
    terms = terms.concat(porDefinicionJa);
  }

  return terminar(await fase("armar", armar(terms, dicts, matched, inflectedByTerm, undefined, cruzados, relevanciaJaponesa(q))));
}

/** `mostrar`: forma que se enseña como «escrita» si no es la propia candidata. */
type Fase = <T>(nombre: string, trabajo: Promise<T>) => Promise<T>;
type Deshacer = (formas: string[], destino: Term[], matched: Set<string>, inflectedByTerm: Map<number, Inflected>, mostrar?: string, soloLectura?: boolean) => Promise<void>;

/** Huecos que se guardan a la segunda lista cuando una consulta latina da las dos. */
const CUOTA_SEGUNDA_LISTA = 8;
/** Formas coreanas sin licencias que se pasan por el deinflector (먹어요 a partir de meogeoyo). */
const MAX_DESHACER_KO = 8;

/**
 * Entradas cuya lectura es la consulta romanizada: kaiseki → かいせき → 懐石, 会席, 解析…
 *
 * Las conversiones dan candidatos, no respuestas (ver romanizacion.ts): aquí se quedan los que
 * existen. Si ninguno existe tal cual, se prueba a deshacer conjugaciones (tabeta → 食べる,
 * meogeoyo → 먹다). La forma literal cuenta como coincidencia exacta y las variantes (vocal
 * alargada, k leída como ㄱ…) van detrás.
 */
async function porRomanizacion(
  q: string,
  lookup: (palabras: string[]) => Promise<Term[]>,
  deshacerJapones: Deshacer,
  deshacerCoreano: Deshacer,
  dicts: Map<number, Dictionary>,
  fase: Fase,
): Promise<Entry[]> {
  if (q.replace(/[^a-zA-Z]/g, "").length < 2) return [];
  const ja = candidatosJaponeses(q);
  const ko = (await fase("lectura: ¿coreano?", hayCoreano(dicts))) ? candidatosCoreanos(q) : [];
  if (!ja && !ko.length) return [];

  const matched = new Set<string>();
  const inflectedByTerm = new Map<number, Inflected>();
  const formasJa = ja?.formas ?? [];
  if (ja) {
    matched.add(ja.literal);
    matched.add(toKatakana(ja.literal));
  }
  for (const c of ko) if (c.penalizacion === 0) matched.add(c.hangul);

  const terms = await fase("lectura: consulta", lookup([...formasJa, ...ko.map(c => c.hangul)]));
  const hayJa = terms.some(t => !esCoreano(t.expression));
  const hayKo = terms.some(t => esCoreano(t.expression));
  // Conjugaciones solo si ningún idioma ha encontrado la palabra tal cual: si kaiseki ya es 懐石,
  // no hay que cargar el deinflector coreano (100 KB) ni gastar otra consulta en buscar 개세기.
  if (!hayJa && !hayKo) {
    const fieles = ko.filter(c => c.penalizacion === 0).slice(0, MAX_DESHACER_KO).map(c => c.hangul);
    await Promise.all([
      ja ? deshacerJapones([ja.literal, toKatakana(ja.literal)], terms, matched, inflectedByTerm, undefined, true) : undefined,
      // Se enseña lo tecleado: meogeoyo puede ser 머거요 o 먹어요 y no hay forma fiable de elegir.
      fieles.length ? deshacerCoreano(fieles, terms, matched, inflectedByTerm, q, true) : undefined,
    ]);
  }
  return terms.length ? fase("lectura: armar", armar(terms, dicts, matched, inflectedByTerm)) : [];
}

/** ¿Hay algún diccionario con palabras en hangul? Se guarda por conjunto de diccionarios activos. */
const coreanoPorDiccionarios = new Map<string, boolean>();

/**
 * Sin diccionario coreano no tiene sentido buscar los candidatos en hangul: son decenas de claves
 * por consulta. Basta un salto en el índice de lecturas al rango de las sílabas hangul.
 */
async function hayCoreano(dicts: Map<number, Dictionary>): Promise<boolean> {
  const huella = [...dicts.keys()].sort((a, b) => a - b).join(",");
  const guardado = coreanoPorDiccionarios.get(huella);
  if (guardado !== undefined) return guardado;
  // Sin filtrar por diccionario activo a propósito: filtrar obligaría a recorrer todo el rango si el
  // coreano está desactivado. Con uno desactivado se prueban candidatos de más y ya está.
  const alguno = await db.terms.where("reading").between("가", "힣", true, true).first();
  coreanoPorDiccionarios.set(huella, alguno !== undefined);
  return alguno !== undefined;
}

/** Une dos listas de resultados sin repetir palabra, guardando sitio a la segunda. */
function juntar(primera: Entry[], segunda: Entry[]): Entry[] {
  const clave = (e: Entry) => `${e.expression}\u0000${e.reading}`;
  const enPrimera = new Set(primera.map(clave));
  const resto = segunda.filter(e => !enPrimera.has(clave(e)));
  const reserva = Math.min(resto.length, CUOTA_SEGUNDA_LISTA);
  return [...primera.slice(0, MAX_ENTRIES - reserva), ...resto].slice(0, MAX_ENTRIES);
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
/** Cuántos sentidos se miran antes de dar por perdida la relevancia de una entrada. */
const MAX_SEGMENTOS = 60;

function relevanciaJaponesa(q: string): (t: Term) => number {
  // Muchos diccionarios (KRDICT entre ellos) dan el equivalente como lectura+kanji: ひと【人】.
  // Lo de dentro de los corchetes es exactamente la palabra, así que cuenta como equivalente.
  const entreCorchetes = `【${q}】`;
  return (t: Term) => {
    const segmentos = segmentosGlosario(t.glossary);
    let mejor = 3;
    let donde = MAX_SEGMENTOS;
    for (let i = 0; i < segmentos.length && i < MAX_SEGMENTOS; i++) {
      const seg = segmentos[i];
      let nivel = 3;
      if (seg === q || seg.includes(entreCorchetes)) nivel = 0;
      else if (seg.startsWith(q)) nivel = 1;
      else if (seg.includes(q)) nivel = 2;
      if (nivel < mejor) { mejor = nivel; donde = i; }
      if (mejor === 0) break;
    }
    // El sentido en el que aparece desempata: los diccionarios ponen primero el equivalente
    // principal. Sin esto, buscar 人 devuelve entradas donde 人 sale de pasada antes que 사람.
    return mejor * 1000 + Math.min(donde, MAX_SEGMENTOS);
  };
}

/**
 * Cuánto encaja una definición con lo que se buscó, de 0 (mejor) a 3.
 *
 * Se compara por PALABRAS, no por texto literal, y con el mismo tokenizador que construye el
 * índice. Eso arregla dos cosas de golpe: «to eat» encuentra los sentidos escritos «eat», y los
 * diccionarios que pegan la cabecera al primer sentido («먹다 eat» en KRDICT) dejan de quedarse
 * fuera, porque el coreano no es alfabeto latino y el tokenizador lo descarta solo.
 */
function relevancia(q: string): (t: Term) => number {
  const buscados = tokenizar(q);
  const clave = buscados.join(" ");
  return (t: Term) => {
    if (!buscados.length) return 3;
    let mejor = 3;
    for (const seg of segmentosGlosario(t.glossary)) {
      const palabras = tokenizar(seg);
      if (!palabras.length) continue;
      if (palabras.join(" ") === clave) return 0;                              // el sentido ES eso
      if (buscados.every(b => palabras.includes(b))) mejor = Math.min(mejor, 1); // está entero
      else if (mejor > 2 && buscados.some(b => palabras.includes(b))) mejor = 2; // solo una parte
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
  repartir = false,
): Promise<Entry[]> {
  const groups = new Map<string, { expression: string; reading: string; score: number; rel: number; cruzado: boolean; prioridad: number; terms: Term[]; inflected?: Inflected }>();
  const seen = new Set<number>();
  for (const t of terms) {
    if (seen.has(t.id!)) continue;
    seen.add(t.id!);
    const key = `${t.expression}\u0000${t.reading}`;
    const g = groups.get(key) ?? { expression: t.expression, reading: t.reading, score: -Infinity, rel: Number.MAX_SAFE_INTEGER, cruzado: false, prioridad: Number.MAX_SAFE_INTEGER, terms: [] };
    g.score = Math.max(g.score, t.score);
    // Una entrada puede venir de varios diccionarios; manda el de más prioridad.
    g.prioridad = Math.min(g.prioridad, dicts.get(t.dict)?.order ?? t.dict);
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

  /**
   * Reparte los huecos entre diccionarios en vez de dárselos todos al que más coincidencias tenga.
   *
   * Buscar «to eat» con JMdict y KRDICT daba veinte resultados japoneses y ninguno coreano. Cada
   * diccionario con resultados se lleva un mínimo garantizado, y lo que sobra va por prioridad
   * (el orden de las flechas en Diccionarios) y luego por ranking.
   */
  const repartirPorDiccionario = (todos: Grupo[]): Grupo[] => {
    const porDiccionario = new Map<number, Grupo[]>();
    for (const g of todos) {
      const lista = porDiccionario.get(g.prioridad);
      if (lista) lista.push(g);
      else porDiccionario.set(g.prioridad, [g]);
    }
    if (porDiccionario.size < 2) return todos.sort(comparar).slice(0, MAX_ENTRIES);

    for (const lista of porDiccionario.values()) lista.sort(comparar);
    const elegidos: Grupo[] = [];
    const puestos = new Set<Grupo>();
    for (const prioridad of [...porDiccionario.keys()].sort((a, b) => a - b)) {
      for (const g of porDiccionario.get(prioridad)!.slice(0, MIN_POR_DICCIONARIO)) {
        if (elegidos.length >= MAX_ENTRIES) break;
        elegidos.push(g);
        puestos.add(g);
      }
    }
    const resto = todos
      .filter(g => !puestos.has(g))
      .sort((a, b) => a.prioridad - b.prioridad || comparar(a, b));
    return [...elegidos, ...resto].slice(0, MAX_ENTRIES);
  };

  /**
   * Quita las entradas repetidas que solo se diferencian en la forma de la palabra.
   *
   * Los diccionarios coreanos meten las formas conjugadas como entradas sueltas para que Yomitan
   * las encuentre sin deinflector: 든, 듭, 드 y 듦 comparten definición con 들다. Buscando "to eat"
   * llenaban la lista. Se comparan las definiciones ignorando el coreano (que es donde está la
   * diferencia) y se conserva la expresión más larga, que es la forma de diccionario.
   */
  const quitarRepetidos = (lista: Grupo[]): Grupo[] => {
    const mejorPorFirma = new Map<string, Grupo>();
    const salida: Grupo[] = [];
    for (const g of lista) {
      const texto = segmentosGlosario(g.terms[0].glossary).join(" ");
      const firma = `${g.prioridad} ${texto.replace(/[가-힯]+/g, "").trim().slice(0, 160)}`;
      const previo = mejorPorFirma.get(firma);
      if (!previo) {
        mejorPorFirma.set(firma, g);
        salida.push(g);
      } else if (g.expression.length > previo.expression.length) {
        salida[salida.indexOf(previo)] = g;
        mejorPorFirma.set(firma, g);
      }
    }
    return salida;
  };

  let sorted: Grupo[];
  const todos = repartir ? quitarRepetidos([...groups.values()]) : [...groups.values()];
  if (repartir) {
    sorted = repartirPorDiccionario(todos);
  } else if (cruzados?.size) {
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
