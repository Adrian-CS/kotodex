// Romanización → escritura nativa, para poder buscar «kaiseki» y encontrar 懐石, o «sarang» y
// encontrar 사랑.
//
// Las dos conversiones devuelven CANDIDATOS, no una respuesta: la romanización pierde información
// (tokyo no dice que sea とうきょう; kimchi no dice si la k es ㄱ o ㅋ) y lo que decide es si el
// candidato existe en algún diccionario. Por eso aquí no hay acceso a la base de datos: solo se
// genera, y la búsqueda filtra.

const VOCALES_JA: Record<string, string> = { a: "あ", i: "い", u: "う", e: "え", o: "お" };

/** Sílabas rōmaji (Hepburn, Kunrei y lo que suele teclear un IME) → hiragana. */
const SILABAS_JA: Record<string, string> = (() => {
  const t: Record<string, string> = { ...VOCALES_JA };
  const filas: [string, string][] = [
    ["k", "かきくけこ"], ["g", "がぎぐげご"], ["s", "さしすせそ"], ["z", "ざじずぜぞ"],
    ["t", "たちつてと"], ["d", "だぢづでど"], ["n", "なにぬねの"], ["h", "はひふへほ"],
    ["b", "ばびぶべぼ"], ["p", "ぱぴぷぺぽ"], ["m", "まみむめも"], ["r", "らりるれろ"],
  ];
  for (const [c, kana] of filas) {
    [..."aiueo"].forEach((v, i) => { t[c + v] = kana[i]; });
  }
  // Contraídas: kya, sha, cha, ja…
  const contraidas: [string, string][] = [
    ["ky", "き"], ["gy", "ぎ"], ["sy", "し"], ["sh", "し"], ["zy", "じ"], ["jy", "じ"], ["j", "じ"],
    ["ty", "ち"], ["cy", "ち"], ["ch", "ち"], ["dy", "ぢ"], ["ny", "に"], ["hy", "ひ"], ["by", "び"],
    ["py", "ぴ"], ["my", "み"], ["ry", "り"],
  ];
  for (const [c, base] of contraidas) {
    t[c + "a"] = base + "ゃ";
    t[c + "u"] = base + "ゅ";
    t[c + "o"] = base + "ょ";
    if (c === "sh" || c === "ch" || c === "j") t[c + "e"] = base + "ぇ";
  }
  Object.assign(t, {
    shi: "し", chi: "ち", tsu: "つ", fu: "ふ", ji: "じ",
    ya: "や", yu: "ゆ", yo: "よ", ye: "いぇ",
    wa: "わ", wi: "うぃ", we: "うぇ", wo: "を",
    fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", tsa: "つぁ",
    vu: "ゔ", va: "ゔぁ", vi: "ゔぃ", ve: "ゔぇ", vo: "ゔぉ",
    // Pequeños, por si alguien teclea como en el IME.
    xa: "ぁ", xi: "ぃ", xu: "ぅ", xe: "ぇ", xo: "ぉ", xtu: "っ", xtsu: "っ", ltu: "っ", ltsu: "っ",
    xya: "ゃ", xyu: "ゅ", xyo: "ょ",
  });
  return t;
})();

const ES_VOCAL = (c: string | undefined) => c !== undefined && "aiueo".includes(c);

/** Quita macrones y circunflejos: ō → o. La vocal larga la recupera `alargar`. */
const sinMacrones = (s: string) =>
  s.normalize("NFD").replace(/[̄̂]/g, "").normalize("NFC");

/**
 * Rōmaji → hiragana tal cual, o null si no es rōmaji válido («bridge», «water»).
 *
 * La ん sigue la costumbre de Hepburn, no la del IME: «konnichiwa» es こんにちわ, no こんいちわ.
 * Una n va con la vocal siguiente si la hay; si no (consonante, final o apóstrofo), es ん.
 */
export function romajiAHiragana(entrada: string): string | null {
  const s = sinMacrones(entrada.toLowerCase()).replace(/\s+/g, "");
  if (!/^[a-z'-]+$/.test(s)) return null;
  let salida = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "-") { salida += "ー"; i++; continue; }
    if (c === "'") { i++; continue; }
    if (c === "n") {
      const sig = s[i + 1];
      if (sig === "'") { salida += "ん"; i += 2; continue; }
      // «nn» + consonante o final: ん (estilo IME, «kannji», «honn»).
      if (sig === "n" && !ES_VOCAL(s[i + 2]) && s[i + 2] !== "y") { salida += "ん"; i += 2; continue; }
      if (!ES_VOCAL(sig) && sig !== "y") { salida += "ん"; i++; continue; }
    }
    // Consonante doble (kk, tt, ss, pp…) o «tch» de matcha: っ.
    if (c !== "n" && !ES_VOCAL(c) && (s[i + 1] === c || (c === "t" && s[i + 1] === "c" && s[i + 2] === "h"))) {
      salida += "っ";
      i++;
      continue;
    }
    let encontrada = false;
    for (const largo of [4, 3, 2, 1]) {
      const kana = SILABAS_JA[s.slice(i, i + largo)];
      if (kana) { salida += kana; i += largo; encontrada = true; break; }
    }
    if (!encontrada) return null;
  }
  return salida;
}

const FILA_O = new Set([..."おこそとのほもよろごぞどぼぽょ"]);
const FILA_U = new Set([..."うくすつぬふむゆるぐずづぶぷゅ"]);
/** Como mucho tantas vocales alargables: 3^5 = 243 candidatos. */
const MAX_LARGAS = 5;

/**
 * Variantes con vocal larga: tokyo → ときょ, とうきょう, ときょう…
 *
 * Hepburn sin macrones (lo que se teclea en el móvil) no distingue お de おう ni う de うう. Se
 * prueba a alargar cada o/u, con う (とうきょう) o con お (おおきい). La primera es la literal.
 */
function alargar(kana: string): string[] {
  const posiciones: number[] = [];
  for (let i = 0; i < kana.length; i++) {
    const siguiente = kana[i + 1];
    if ((FILA_O.has(kana[i]) || FILA_U.has(kana[i])) && siguiente !== "う" && siguiente !== "お") posiciones.push(i);
  }
  if (posiciones.length > MAX_LARGAS) return [kana];
  let variantes = [{ texto: "", desde: 0 }];
  for (const p of posiciones) {
    const siguientes: typeof variantes = [];
    for (const v of variantes) {
      const tramo = v.texto + kana.slice(v.desde, p + 1);
      siguientes.push({ texto: tramo, desde: p + 1 });
      siguientes.push({ texto: tramo + "う", desde: p + 1 });
      if (FILA_O.has(kana[p])) siguientes.push({ texto: tramo + "お", desde: p + 1 });
    }
    variantes = siguientes;
  }
  return variantes.map(v => v.texto + kana.slice(v.desde));
}

const aKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

export interface CandidatosJa {
  /** La conversión literal, sin alargar vocales: es la que se pasa por el deinflector. */
  literal: string;
  /** Todas las formas a buscar (hiragana y katakana), la literal primero. */
  formas: string[];
}

/** Candidatos en kana para una consulta en rōmaji, o null si no es rōmaji. */
export function candidatosJaponeses(q: string): CandidatosJa | null {
  const literal = romajiAHiragana(q);
  if (!literal) return null;
  const formas = new Set<string>();
  for (const v of alargar(literal)) {
    formas.add(v);
    formas.add(aKatakana(v));
    // Préstamos: en katakana la vocal larga es ー (コンピュータ, ボーナス), no ウ ni オ.
    if (v !== literal) formas.add(aKatakana(marcarLargas(literal, v)));
  }
  return { literal, formas: [...formas] };
}

/** Sustituye por ー las vocales que `alargar` ha añadido a `literal` para formar `variante`. */
function marcarLargas(literal: string, variante: string): string {
  let salida = "";
  let j = 0;
  for (const c of variante) {
    if (j < literal.length && c === literal[j]) { salida += c; j++; }
    else salida += "ー";
  }
  return salida;
}

// ─── Coreano ──────────────────────────────────────────────────────────────────────────────────
//
// Romanización revisada (la oficial: sarang, hangeul, eomma), con manga ancha para lo que la gente
// escribe de verdad: «kimchi» con k por ㄱ (McCune-Reischauer), «chingu» con ch por ㅈ. Cada
// licencia suma una penalización, y los candidatos sin ninguna van primero.
//
// La romanización revisada transcribe la pronunciación, así que una consonante final ante vocal
// se escribe con la sílaba siguiente (먹어요 = meogeoyo). Por eso se prueban todas las formas de
// partir en sílabas: meo-geo-yo (머거요) y meog-eo-yo (먹어요) salen las dos y el diccionario decide.

type Opcion = [indice: number, penalizacion: number];

/** Iniciales: ㄱ0 ㄲ1 ㄴ2 ㄷ3 ㄸ4 ㄹ5 ㅁ6 ㅂ7 ㅃ8 ㅅ9 ㅆ10 ㅇ11 ㅈ12 ㅉ13 ㅊ14 ㅋ15 ㅌ16 ㅍ17 ㅎ18 */
const INICIALES: Record<string, Opcion[]> = {
  g: [[0, 0]], kk: [[1, 0]], k: [[15, 0], [0, 1]], n: [[2, 0]], d: [[3, 0]], tt: [[4, 0]],
  t: [[16, 0], [3, 1]], r: [[5, 0]], l: [[5, 0]], m: [[6, 0]], b: [[7, 0]], pp: [[8, 0]],
  p: [[17, 0], [7, 1]], s: [[9, 0], [10, 1]], ss: [[10, 0]], sh: [[9, 1]], j: [[12, 0]],
  jj: [[13, 0]], ch: [[14, 0], [12, 1]], h: [[18, 0]], "": [[11, 0]],
};

/** Vocales: ㅏ0 ㅐ1 ㅑ2 ㅒ3 ㅓ4 ㅔ5 ㅕ6 ㅖ7 ㅗ8 ㅘ9 ㅙ10 ㅚ11 ㅛ12 ㅜ13 ㅝ14 ㅞ15 ㅟ16 ㅠ17 ㅡ18 ㅢ19 ㅣ20 */
const VOCALES_KO: Record<string, number> = {
  a: 0, ae: 1, ya: 2, yae: 3, eo: 4, e: 5, yeo: 6, ye: 7, o: 8, wa: 9, wae: 10, oe: 11,
  yo: 12, u: 13, wo: 14, we: 15, wi: 16, yu: 17, eu: 18, ui: 19, i: 20,
};

/**
 * Finales: ㄱ1 ㄲ2 ㄴ4 ㄷ7 ㄹ8 ㅁ16 ㅂ17 ㅅ19 ㅆ20 ㅇ21 ㅈ22 ㅊ23 ㅋ24 ㅌ25 ㅍ26 ㅎ27.
 * A final de sílaba, ㄷ ㅅ ㅆ ㅈ ㅊ ㅌ ㅎ suenan todas t (맛 = mat, 꽃 = kkot). Las letras sonoras
 * (g, d, b, s, j…) solo aparecen en enlace con la vocal siguiente. m/ng pueden venir de ㅂ/ㄱ
 * nasalizadas (합니다 = hamnida).
 */
const FINALES: Record<string, Opcion[]> = {
  k: [[1, 0], [24, 1], [2, 1]], g: [[1, 0]], kk: [[2, 0]],
  n: [[4, 0]], ng: [[21, 0], [1, 1]],
  t: [[7, 0], [19, 0], [20, 1], [22, 1], [23, 1], [25, 1], [27, 1]],
  d: [[7, 0]], s: [[19, 0]], ss: [[20, 0]], j: [[22, 0]], ch: [[23, 0]], h: [[27, 0]],
  l: [[8, 0]], r: [[8, 0]], m: [[16, 0], [17, 1]], p: [[17, 0], [26, 1]], b: [[17, 0]],
};

const LARGOS_INICIAL = [2, 1, 0];
const LARGOS_VOCAL = [3, 2, 1];
const LARGOS_FINAL = [2, 1];

/** Tope de candidatos coreanos. Una palabra corriente da decenas; esto solo frena casos raros. */
const MAX_CANDIDATOS_KO = 400;
const MAX_PENALIZACION = 3;

export interface CandidatoKo { hangul: string; penalizacion: number }

/** Candidatos en hangul para una consulta romanizada, los más fieles primero. Vacío si no encaja. */
export function candidatosCoreanos(q: string): CandidatoKo[] {
  const s = q.toLowerCase().replace(/[\s']+/g, "");
  if (!/^[a-z-]+$/.test(s) || s.length > 24) return [];

  const mejores = new Map<string, number>();
  let pasos = 0;

  // `-` marca límite de sílaba (jung-ang = 중앙, no 준강): solo se salta entre sílabas.
  const partir = (pos: number, hecho: string, penal: number): void => {
    if (++pasos > 20000 || penal > MAX_PENALIZACION) return;
    if (pos === s.length) {
      if (hecho && (mejores.get(hecho) ?? Infinity) > penal) mejores.set(hecho, penal);
      return;
    }
    if (s[pos] === "-") { partir(pos + 1, hecho, penal); return; }
    for (const li of LARGOS_INICIAL) {
      const opcionesI = INICIALES[s.slice(pos, pos + li)];
      if (!opcionesI || pos + li > s.length) continue;
      for (const lv of LARGOS_VOCAL) {
        const v = VOCALES_KO[s.slice(pos + li, pos + li + lv)];
        if (v === undefined || pos + li + lv > s.length) continue;
        const trasVocal = pos + li + lv;
        const finales: [number, Opcion[]][] = [[0, [[0, 0]]]];
        for (const lf of LARGOS_FINAL) {
          const f = FINALES[s.slice(trasVocal, trasVocal + lf)];
          if (f && trasVocal + lf <= s.length) finales.push([lf, f]);
        }
        for (const [lf, opcionesF] of finales) {
          for (const [i, pi] of opcionesI) {
            for (const [f, pf] of opcionesF) {
              const silaba = String.fromCharCode(0xac00 + (i * 21 + v) * 28 + f);
              partir(trasVocal + lf, hecho + silaba, penal + pi + pf);
            }
          }
        }
      }
    }
  };
  partir(0, "", 0);

  return [...mejores]
    .map(([hangul, penalizacion]) => ({ hangul, penalizacion }))
    .sort((a, b) => a.penalizacion - b.penalizacion || a.hangul.length - b.hangul.length)
    .slice(0, MAX_CANDIDATOS_KO);
}
