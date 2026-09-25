// Deshace conjugaciones coreanas: 먹었어요 → 먹다.
//
// Mismo algoritmo que el japonés (deinflect.ts), pero con dos diferencias:
//   - Las reglas operan sobre JAMO descompuestos, no sobre sílabas: 먹다 es ㅁㅓㄱㄷㅏ. Así que se
//     descompone al entrar y se recompone al salir.
//   - Las condiciones son 15 clases (verbo, adjetivo, 이다 y terminaciones intermedias) en vez de
//     las clases de palabra japonesas.
//
// Este módulo y su tabla (105 KB) se cargan bajo demanda desde search.ts: quien no use coreano no
// se los descarga.

import Hangul from "hangul-js";
import { CONDICIONES, TABLA_KO } from "./deinflect-ko-rules.ts";

const BIT: Record<string, number> = {};
CONDICIONES.forEach((nombre, i) => { BIT[String.fromCharCode(97 + i)] = 1 << i; });

/** Formas que pueden estar en el diccionario: verbo, adjetivo y la partícula 이다. */
export const FORMA_DE_DICCIONARIO = BIT.a | BIT.b | BIT.c;

interface Regla { from: string; to: string; in: number; out: number }

const mascara = (codigo: string) => [...codigo].reduce((m, c) => m | (BIT[c] ?? 0), 0);

const REGLAS: [string, Regla[]][] = TABLA_KO.map(([nombre, filas]) => [
  nombre,
  filas.map(fila => {
    const [from, to, ci, co] = fila.split(":");
    return { from, to, in: mascara(ci), out: mascara(co) };
  }),
]);

export interface DeinflexionKo {
  /** Forma candidata, ya recompuesta en sílabas. */
  term: string;
  /** Clases posibles; 0 = la palabra tal cual, sin restricción. */
  conditions: number;
  /** Conjugaciones deshechas, de la forma de diccionario hacia fuera. */
  reasons: string[];
}

/** Tope de candidatos: con 2682 reglas, una palabra larga se dispara sin esto. */
const MAX_CANDIDATOS = 300;

const descomponer = (texto: string): string => Hangul.disassemble(texto, false).join("");
const recomponer = (jamo: string): string => Hangul.assemble([...jamo]);

/**
 * Todas las formas de diccionario que podrían haber producido `source`, incluida `source` misma
 * (la primera, con reasons vacío). No comprueba si existen: eso lo hace la búsqueda.
 */
export function deinflectKorean(source: string): DeinflexionKo[] {
  const raiz = descomponer(source);
  if (!raiz) return [];

  // Se trabaja en jamo y solo se recompone al devolver.
  const enJamo: { jamo: string; conditions: number; reasons: string[] }[] =
    [{ jamo: raiz, conditions: 0, reasons: [] }];
  const vistos = new Set<string>([`${raiz}\u00000`]);

  for (let i = 0; i < enJamo.length && enJamo.length < MAX_CANDIDATOS; i++) {
    const { jamo, conditions, reasons } = enJamo[i];
    for (const [razon, reglas] of REGLAS) {
      for (const regla of reglas) {
        if (conditions !== 0 && (conditions & regla.in) === 0) continue;
        if (!jamo.endsWith(regla.from)) continue;
        const largo = jamo.length - regla.from.length + regla.to.length;
        if (largo <= 0) continue;
        const siguiente = jamo.slice(0, jamo.length - regla.from.length) + regla.to;
        const clave = `${siguiente}\u0000${regla.out}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        enJamo.push({ jamo: siguiente, conditions: regla.out, reasons: [razon, ...reasons] });
      }
    }
  }

  return enJamo.map(c => ({
    term: recomponer(c.jamo),
    conditions: c.conditions,
    reasons: c.reasons,
  }));
}
