import { execFileSync } from "node:child_process";

/** Genera los diccionarios de prueba (test-dicts/ no se sube). Siempre: tarda nada y así no quedan viejos. */
export default function preparar() {
  execFileSync("python3", ["scripts/make-test-dicts.py"], { stdio: "inherit" });
}
