// Tokenizador del índice de definiciones (búsqueda inglés/español → japonés).
// node --experimental-strip-types scripts/test-glosses.ts  (o npm test)

import { esConsultaLatina, indexWords, normalizar, tokenizar } from "../src/glosses.ts";

let fallos = 0;
const comprobar = (etiqueta: string, real: unknown, esperado: unknown) => {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    console.log(`ok    ${etiqueta}`);
  } else {
    fallos++;
    console.log(`FALLA ${etiqueta}\n        real:     ${a}\n        esperado: ${b}`);
  }
};

comprobar("quita palabras vacías", tokenizar("to eat"), ["eat"]);
comprobar("varias palabras", tokenizar("train station"), ["train", "station"]);
comprobar("quita tildes", tokenizar("árbol"), ["arbol"]);
comprobar("normaliza mayúsculas", normalizar("Está"), "esta");
comprobar("ignora letras sueltas y vacías", tokenizar("a b to"), []);
comprobar("no repite palabras", tokenizar("end end edge"), ["end", "edge"]);
comprobar("el japonés no aporta nada", tokenizar("食べ物を口に入れてかむ。"), []);

comprobar("glosario de cadenas", indexWords(["bridge"]), ["bridge"]);
comprobar("varios sentidos", indexWords(["end (e.g. of street)", "edge", "tip"]),
  ["end", "street", "edge", "tip"]);
comprobar("structured-content", indexWords([
  { type: "structured-content", content: [{ tag: "span", content: "to eat food" }] },
]), ["eat", "food"]);
comprobar("objeto de texto", indexWords([{ type: "text", text: "puente" }]), ["puente"]);
comprobar("un monolingüe no ocupa índice", indexWords(["川・谷・道路などの両側を結んで"]), []);

comprobar("consulta en inglés", esConsultaLatina("bridge"), true);
comprobar("consulta en español", esConsultaLatina("puente"), true);
comprobar("consulta en kanji", esConsultaLatina("橋"), false);
comprobar("consulta en kana", esConsultaLatina("はし"), false);
comprobar("consulta mixta no cuenta como latina", esConsultaLatina("橋 bridge"), false);
comprobar("solo números no cuenta como latina", esConsultaLatina("123"), false);

console.log(fallos === 0 ? "\ntodos los casos correctos" : `\n${fallos} casos fallan`);
process.exit(fallos === 0 ? 0 : 1);
