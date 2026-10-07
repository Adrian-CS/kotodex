// Romanización → kana / hangul: node --experimental-strip-types scripts/test-romanizacion.ts (o npm test)
// Las conversiones dan candidatos; aquí se comprueba que el bueno está entre ellos.

import { candidatosCoreanos, candidatosJaponeses, romajiAHiragana } from "../src/romanizacion.ts";

let fallos = 0;
const comprobar = (etiqueta: string, ok: boolean, detalle: unknown) => {
  if (ok) console.log(`ok    ${etiqueta}`);
  else { fallos++; console.log(`FALLA ${etiqueta}\n        ${JSON.stringify(detalle)}`); }
};

const LITERALES: [string, string | null][] = [
  ["kaiseki", "かいせき"],
  ["konnichiwa", "こんにちわ"],   // la n va con la vocal siguiente (Hepburn), no こんいちわ
  ["onna", "おんな"],
  ["kanji", "かんじ"],
  ["shinbun", "しんぶん"],
  ["hon'ya", "ほんや"],
  ["matcha", "まっちゃ"],
  ["kitte", "きって"],
  ["tsukue", "つくえ"],
  ["ōkii", "おきい"],             // el macrón se quita; la vocal larga la pone `alargar`
  ["bridge", null],                // inglés: no es rōmaji
  ["water", null],
];
for (const [q, esperado] of LITERALES) {
  const real = romajiAHiragana(q);
  comprobar(`${q} → ${esperado}`, real === esperado, real);
}

const JA: [string, string][] = [
  ["tokyo", "とうきょう"],
  ["ookii", "おおきい"],
  ["okii", "おおきい"],
  ["kyo", "きょう"],
  ["konpyuta", "コンピュータ"],
];
for (const [q, buscado] of JA) {
  const formas = candidatosJaponeses(q)?.formas ?? [];
  comprobar(`${q} incluye ${buscado}`, formas.includes(buscado), formas);
}

const KO: [string, string][] = [
  ["sarang", "사랑"],
  ["saram", "사람"],
  ["mul", "물"],
  ["hangeul", "한글"],
  ["annyeong", "안녕"],
  ["jung-ang", "중앙"],   // el guion fuerza el límite de sílaba
  ["kimchi", "김치"],     // k por ㄱ (McCune-Reischauer)
  ["chingu", "친구"],
  ["meogeoyo", "먹어요"], // enlace: la ㄱ final se escribe con la vocal siguiente
  ["gamsahamnida", "감사합니다"], // ㅂ nasalizada: se escribe m
];
for (const [q, buscado] of KO) {
  const c = candidatosCoreanos(q).map(x => x.hangul);
  comprobar(`${q} incluye ${buscado}`, c.includes(buscado), c.slice(0, 10));
}
comprobar("sarang: 사랑 sin licencias va primero", candidatosCoreanos("sarang")[0]?.hangul === "사랑",
  candidatosCoreanos("sarang").slice(0, 3));
comprobar("fuera del alfabeto coreano no hay candidatos", candidatosCoreanos("fox").length === 0,
  candidatosCoreanos("fox"));

if (fallos) {
  console.log(`\n${fallos} fallo(s)`);
  process.exit(1);
}
