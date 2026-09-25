import { pitchField } from "./pitch";
import type { DefBlock, Entry } from "./search";
import type { Settings } from "./settings";

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
}

const joinBlocks = (blocks: DefBlock[]) =>
  blocks.map(b => `<div class="dict" data-dict="${b.dictTitle.replace(/"/g, "&quot;")}">${b.html}</div>`).join("");

export function buildFields(e: Entry): NoteFields {
  return {
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
  p.set("type", s.noteType);
  p.set("deck", deck);
  for (const [name, value] of Object.entries(fields)) if (value) p.set(`fld${name}`, value);
  if (s.tags) p.set("tags", s.tags);
  // URLSearchParams codifica los espacios como "+"; AnkiMobile espera %20. Un "+" real ya sale como %2B.
  return `anki://x-callback-url/addnote?${p.toString().replace(/\+/g, "%20")}`;
}
