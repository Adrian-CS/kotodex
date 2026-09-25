// Deinflector coreano: node --experimental-strip-types scripts/test-deinflect-ko.ts (o npm test)
// Cada caso es [forma conjugada, forma de diccionario esperada].

import { deinflectKorean } from "../src/deinflect-ko.ts";

const CASOS: [string, string][] = [
  ["먹었어요", "먹다"],      // pasado cortés
  ["먹습니다", "먹다"],      // formal
  ["먹어", "먹다"],          // informal
  ["먹고", "먹다"],          // conectivo
  ["먹으면", "먹다"],        // condicional
  ["먹지", "먹다"],          // conectivo -지 (la negación «먹지 않다» son dos palabras:
                             //  un deinflector por sufijos no puede unirlas, y Yomitan tampoco)
  ["갔어요", "가다"],        // contracción de vocal
  ["했어요", "하다"],        // irregular 하다
  ["합니다", "하다"],
  ["하세요", "하다"],
  ["같았다", "같다"],
  ["예뻐요", "예쁘다"],      // irregular ㅡ
  ["들었어", "듣다"],        // irregular ㄷ
  ["몰라요", "모르다"],      // irregular 르
  ["읽는다", "읽다"],
  ["아니야", "아니다"],
  ["좋아하는", "좋아하다"],  // modificador
];

let fallos = 0;
let candidatosTotales = 0;
const t0 = Date.now();

for (const [forma, esperado] of CASOS) {
  const resultados = deinflectKorean(forma);
  candidatosTotales += resultados.length;
  const hit = resultados.find(d => d.term === esperado && d.reasons.length > 0);
  if (hit) {
    console.log(`ok    ${forma} → ${esperado}   ${hit.reasons.join(" · ")}`);
  } else {
    fallos++;
    const muestra = resultados.slice(1, 10).map(d => d.term).join(" ");
    console.log(`FALLA ${forma} → ${esperado}; ${resultados.length} candidatos: ${muestra}`);
  }
}

const ms = Date.now() - t0;
console.log(
  fallos === 0
    ? `\n${CASOS.length} casos correctos (${candidatosTotales} candidatos, ${ms} ms en total)`
    : `\n${fallos} casos fallan`,
);
process.exit(fallos === 0 ? 0 : 1);
