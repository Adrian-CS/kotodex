import { pitchField } from "./pitch";
import type { DefBlock, Entry } from "./search";
import type { Settings } from "./settings";
import { escapeHtml } from "./structured";

/** Campos del tipo de nota "JP Dict", en el mismo orden que en Anki. */
export interface NoteFields {
  Expression: string;
  Reading: string;
  Audio: string;
  Pitch: string;
  PitchNum: string;
  DefJA: string;
  DefES: string;
  DefEN: string;
  /** Solo en el tipo «JP Dict + frase»: la frase de la que salió la palabra, con ella en <b>. */
  Sentence?: string;
}

/** Sufijo del segundo tipo de nota; el servidor usa el mismo nombre (anki_service.NOTETYPE_FRASE). */
export const SUFIJO_FRASE = " + frase";

/**
 * La frase lista para el campo Sentence: escapada, y con el trozo tocado (la forma tal como
 * aparece, 読んだ y no 読む) en negrita. Posiciones en caracteres, como en SearchView.
 */
export function fraseHtml(texto: string, inicio: number, largo: number): string {
  const c = [...texto];
  const parte = (a: number, b?: number) => escapeHtml(c.slice(a, b).join(""));
  return `${parte(0, inicio)}<b>${parte(inicio, inicio + largo)}</b>${parte(inicio + largo)}`;
}

const joinBlocks = (blocks: DefBlock[]) =>
  blocks.map(b => `<div class="dict" data-dict="${b.dictTitle.replace(/"/g, "&quot;")}">${b.html}</div>`).join("");

export function buildFields(e: Entry, frase?: string): NoteFields {
  return {
    ...(frase ? { Sentence: frase } : {}),
    Expression: e.expression,
    Reading: e.reading,
    Audio: "", // lo rellenará el servidor
    Pitch: e.pitches.length ? pitchField(e.reading, e.pitches) : "",
    PitchNum: e.pitches.join(","),
    DefJA: joinBlocks(e.defs.ja),
    DefES: joinBlocks(e.defs.es),
    DefEN: joinBlocks(e.defs.en),
  };
}

/** Modo sin servidor: abre AnkiMobile con la nota rellenada (URL scheme x-callback-url/addnote). */
export function ankiMobileUrl(fields: NoteFields, s: Settings, deck: string): string {
  const p = new URLSearchParams();
  if (s.profile) p.set("profile", s.profile);
  // Con frase, el tipo «+ frase»: tiene que existir en AnkiMobile (lo crea el servidor o se copia a mano).
  p.set("type", fields.Sentence ? s.noteType + SUFIJO_FRASE : s.noteType);
  p.set("deck", deck);
  for (const [name, value] of Object.entries(fields)) if (value) p.set(`fld${name}`, value);
  if (s.tags) p.set("tags", s.tags);
  // URLSearchParams codifica los espacios como "+"; AnkiMobile espera %20. Un "+" real ya sale como %2B.
  return `anki://x-callback-url/addnote?${p.toString().replace(/\+/g, "%20")}`;
}
