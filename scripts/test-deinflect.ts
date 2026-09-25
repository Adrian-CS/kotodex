// Comprueba el deinflector sin navegador: node --experimental-strip-types scripts/test-deinflect.ts
// (o npm test). Cada caso es [forma escrita, forma de diccionario, campo "rules" de term_bank].

import { deinflect, matchesRules, rulesMask } from "../src/deinflect.ts";

const CASES: [string, string, string][] = [
  ["食べた", "食べる", "v1 vt"],
  ["食べない", "食べる", "v1 vt"],
  ["食べません", "食べる", "v1 vt"],
  ["食べられる", "食べる", "v1 vt"],
  ["食べさせられた", "食べる", "v1 vt"],
  ["食べちゃった", "食べる", "v1 vt"],
  ["食べていました", "食べる", "v1 vt"],
  ["食べよう", "食べる", "v1 vt"],
  ["食べれば", "食べる", "v1 vt"],
  ["読まなかった", "読む", "v5 vt"],
  ["読んでいる", "読む", "v5 vt"],
  ["読みたくない", "読む", "v5 vt"],
  ["読ませて", "読む", "v5 vt"],
  ["行った", "行く", "v5 vi"],
  ["買いたかった", "買う", "v5 vt"],
  ["話せば", "話す", "v5 vt"],
  ["泳ぎすぎた", "泳ぐ", "v5 vi"],
  ["待たされた", "待つ", "v5 vt"],
  ["死んじゃう", "死ぬ", "v5 vn"],
  ["遊ばない", "遊ぶ", "v5 vi"],
  ["高くない", "高い", "adj-i"],
  ["高かった", "高い", "adj-i"],
  ["高すぎる", "高い", "adj-i"],
  ["高さ", "高い", "adj-i"],
  ["よくなかった", "よい", "adj-i"],
  ["しました", "する", "vs"],
  ["されて", "する", "vs"],
  ["勉強しなければ", "勉強する", "vs"],
  ["来なかった", "来る", "vk"],
  ["きて", "くる", "vk"],
  // Los compuestos en 〜てくる se resuelven al compuesto, igual que en Yomitan.
  ["行ってきた", "行ってくる", "vk"],
  ["持ってきた", "持ってくる", "vk"],
];

// Candidatos que existen como palabra pero con otra clase: el campo "rules" tiene que tumbarlos.
const REJECTED: [string, string, string][] = [
  ["した", "しる", "v5 vt"],   // 知る es 五段, así que した no es su pasado
];

let failed = 0;

for (const [form, want, rules] of CASES) {
  const hit = deinflect(form).find(d =>
    d.term === want && d.reasons.length > 0 && matchesRules(d.rules, rulesMask(rules)));
  if (hit) {
    console.log(`ok    ${form} → ${want}   ${hit.reasons.join(" · ")}`);
  } else {
    failed++;
    const got = deinflect(form).filter(d => d.reasons.length).map(d => d.term).join(" ");
    console.log(`FALLA ${form} → ${want}; candidatos: ${got}`);
  }
}

for (const [form, term, rules] of REJECTED) {
  const candidate = deinflect(form).find(d => d.term === term);
  const rejected = !candidate || !matchesRules(candidate.rules, rulesMask(rules));
  if (rejected) {
    console.log(`ok    ${form} no se resuelve como ${term} (${rules})`);
  } else {
    failed++;
    console.log(`FALLA ${form} se acepta como ${term} aunque sea ${rules}`);
  }
}

console.log(failed === 0
  ? `\n${CASES.length + REJECTED.length} casos correctos`
  : `\n${failed} casos fallan`);
process.exit(failed === 0 ? 0 : 1);
