import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, entryKey } from "../db";
import { pitchField } from "../pitch";
import type { DefRole, Entry } from "../search";
import type { Settings } from "../settings";
import { ankiMobileUrl, buildFields } from "../anki";
import { addNote, ServerError } from "../server";

const SECTIONS: { role: DefRole; label: string; lang: string }[] = [
  { role: "ja", label: "国語", lang: "ja" },
  { role: "es", label: "Español", lang: "es" },
  { role: "en", label: "English", lang: "en" },
];

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; text: string }
  | { kind: "error"; message: string; duplicate: boolean };

interface Props { entry: Entry; settings: Settings; setSettings: (s: Settings) => void }

export function EntryCard({ entry, settings, setSettings }: Props) {
  const key = entryKey(entry.expression, entry.reading);
  const added = useLiveQuery(() => db.added.get(key), [key]);
  const deck = settings.decks.includes(settings.lastDeck) ? settings.lastDeck : settings.decks[0] ?? "";
  const showReading = entry.reading !== entry.expression;
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function addToAnki(allowDuplicate = false) {
    if (!deck) return;
    const fields = buildFields(entry);

    if (settings.mode === "ankimobile") {
      await db.added.put({ key, deck, at: Date.now() });
      window.location.href = ankiMobileUrl(fields, settings, deck);
      return;
    }

    setStatus({ kind: "sending" });
    try {
      const note = await addNote(settings, fields, deck, { allowDuplicate });
      await db.added.put({ key, deck, at: Date.now() });
      setStatus({
        kind: "done",
        text: note.audio ? `Añadida a ${note.deck} con audio` : `Añadida a ${note.deck}, sin audio`,
      });
    } catch (e) {
      const error = e as ServerError;
      setStatus({ kind: "error", message: error.message, duplicate: error.duplicate === true });
    }
  }

  const sending = status.kind === "sending";
  const label = sending ? "Añadiendo…" : added ? "Añadir otra vez" : "Añadir a Anki";

  return (
    <article className="entry">
      <header className="entry-head">
        {entry.inflected && (
          <p className="entry-inflected">
            <span lang="ja">{entry.inflected.form}</span> · {entry.inflected.reasons.join(" · ")}
          </p>
        )}
        {showReading && <div className="entry-reading" lang="ja">{entry.reading}</div>}
        <h2 className="entry-word" lang="ja">{entry.expression}</h2>
      </header>

      {entry.pitches.length > 0 && (
        <div className="pitch-block" dangerouslySetInnerHTML={{ __html: pitchField(entry.reading, entry.pitches) }} />
      )}

      {SECTIONS.map(({ role, label, lang }) => entry.defs[role].length > 0 && (
        <section key={role} className={`defs defs-${role}`} lang={lang}>
          <h3 className="defs-label">{label}</h3>
          {entry.defs[role].map(b => (
            <div key={b.dictTitle} className="dict-block">
              {entry.defs[role].length > 1 && <div className="dict-name">{b.dictTitle}</div>}
              <div className="def-html" dangerouslySetInnerHTML={{ __html: b.html }} />
            </div>
          ))}
        </section>
      ))}

      <footer className="entry-actions">
        <select
          value={deck}
          onChange={e => setSettings({ ...settings, lastDeck: e.target.value })}
          aria-label="Mazo"
        >
          {settings.decks.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className="primary" onClick={() => addToAnki()} disabled={!deck || sending}>
          {label}
        </button>
      </footer>

      {status.kind === "done" && <p className="added-note">{status.text}</p>}
      {status.kind === "error" && (
        <p className="error added-note">
          {status.message}
          {status.duplicate && (
            <>
              {" "}
              <button className="text" onClick={() => addToAnki(true)}>Añadir igualmente</button>
            </>
          )}
        </p>
      )}
      {status.kind === "idle" && added && <p className="added-note">Añadida a {added.deck}</p>}
    </article>
  );
}
