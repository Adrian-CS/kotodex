import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Genera los diccionarios de prueba si no están (en el CI nunca están: test-dicts/ no se sube). */
export default function preparar() {
  if (!existsSync("test-dicts/kanji.zip")) execFileSync("python3", ["scripts/make-test-dicts.py"], { stdio: "inherit" });
}
