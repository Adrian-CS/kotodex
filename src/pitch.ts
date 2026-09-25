// Genera el gráfico de pitch accent como SVG inline (para meterlo en un campo de Anki).
// Entrada: lectura en kana + número de downstep (formato Kanjium: 0 = heiban, 1 = atamadaka, n = cae tras la mora n).

const SMALL_KANA = new Set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ");

/** Divide una lectura en moras: los kana pequeños se pegan a la anterior; っ, ー y ん cuentan como mora propia. */
export function splitMorae(reading: string): string[] {
  const morae: string[] = [];
  for (const ch of reading) {
    if (SMALL_KANA.has(ch) && morae.length > 0) morae[morae.length - 1] += ch;
    else morae.push(ch);
  }
  return morae;
}

/** Devuelve alto (true) / bajo (false) por mora, más una posición extra para la partícula (が, は…). */
export function pitchPattern(moraCount: number, downstep: number): boolean[] {
  const p: boolean[] = [];
  for (let i = 0; i <= moraCount; i++) {
    if (downstep === 0) p.push(i > 0);                 // heiban: bajo → alto, partícula alta
    else if (downstep === 1) p.push(i === 0);          // atamadaka: alto → bajo
    else p.push(i > 0 && i < downstep);                // nakadaka / odaka
  }
  return p;
}

export function pitchName(moraCount: number, downstep: number): string {
  if (downstep === 0) return "平板";
  if (downstep === 1) return "頭高";
  if (downstep === moraCount) return "尾高";
  return "中高";
}

const STEP = 30, HIGH_Y = 12, LOW_Y = 34, LABEL_Y = 60, R = 4.5, PAD = 10;

export function pitchSvg(reading: string, downstep: number): string {
  const morae = splitMorae(reading);
  const pattern = pitchPattern(morae.length, downstep);
  const x = (i: number) => PAD + i * STEP;
  const y = (i: number) => (pattern[i] ? HIGH_Y : LOW_Y);
  const width = PAD * 2 + morae.length * STEP;

  const lines = pattern.slice(1).map((_, k) =>
    `<line x1="${x(k)}" y1="${y(k)}" x2="${x(k + 1)}" y2="${y(k + 1)}"/>`).join("");

  const dots = pattern.map((_, i) => i === morae.length
    ? `<circle class="particle" cx="${x(i)}" cy="${y(i)}" r="${R}"/>`   // partícula: hueca
    : `<circle cx="${x(i)}" cy="${y(i)}" r="${R}"/>`).join("");

  const labels = morae.map((m, i) =>
    `<text x="${x(i)}" y="${LABEL_Y}">${m}</text>`).join("");

  return `<svg class="pitch" viewBox="0 0 ${width} 70" width="${width}" height="70" ` +
    `role="img" aria-label="${reading} [${downstep}] ${pitchName(morae.length, downstep)}">` +
    `<g class="pitch-lines">${lines}</g><g class="pitch-dots">${dots}</g>` +
    `<g class="pitch-labels">${labels}</g></svg>`;
}

/** Varias acentuaciones posibles (p. ej. Kanjium "0,2") → un bloque HTML para el campo Pitch. */
export function pitchField(reading: string, downsteps: number[]): string {
  return downsteps.map(d =>
    `<figure class="pitch-item">${pitchSvg(reading, d)}` +
    `<figcaption>[${d}] ${pitchName(splitMorae(reading).length, d)}</figcaption></figure>`
  ).join("");
}
