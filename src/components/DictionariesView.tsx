import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Role } from "../db";
import { deleteDictionary, importDictionary, type ImportProgress } from "../importer";

const ROLES: { value: Role; label: string }[] = [
  { value: "ja", label: "Definición en japonés" },
  { value: "es", label: "Definición en español" },
  { value: "en", label: "Definición en inglés" },
  { value: "pitch", label: "Pitch accent" },
  { value: "other", label: "No usar" },
];

const formatMB = (bytes?: number) => (bytes == null ? "—" : `${(bytes / 1024 / 1024).toFixed(0)} MB`);

export function DictionariesView() {
  const dicts = useLiveQuery(() => db.dictionaries.toArray(), []);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ usage?: number; quota?: number }>({});

  useEffect(() => {
    navigator.storage?.estimate?.().then(setUsage).catch(() => {});
  }, [dicts]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        await importDictionary(file, setProgress);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    }
    setProgress(null);
  }

  async function onDelete(id: number, title: string) {
    if (confirm(`¿Borrar «${title}»? Tendrás que volver a importar el .zip para recuperarlo.`)) await deleteDictionary(id);
  }

  const busy = progress !== null;

  return (
    <div className="page">
      <h1>Diccionarios</h1>
      <p className="hint">Importa diccionarios en formato Yomitan (.zip). Se guardan solo en este dispositivo.</p>

      <label className={`primary file-button${busy ? " disabled" : ""}`}>
        {busy ? "Importando…" : "Importar .zip"}
        <input type="file" accept=".zip,application/zip" multiple disabled={busy} onChange={e => { onFiles(e.target.files); e.target.value = ""; }} hidden />
      </label>

      {progress && (
        <div className="progress" role="status">
          <div>{progress.stage}</div>
          <progress value={progress.done} max={progress.total} />
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <ul className="dict-list">
        {dicts?.map(d => (
          <li key={d.id} className="dict-item">
            <div className="dict-title">{d.title}</div>
            <div className="dict-meta">
              {[
                d.terms > 0 && `${d.terms.toLocaleString("es")} términos`,
                // Saber si un diccionario trae pitch es lo primero que se mira cuando no aparece.
                d.pitches ? `${d.pitches.toLocaleString("es")} con pitch` : null,
                d.metas > 0 && `${d.metas.toLocaleString("es")} datos meta`,
              ].filter(Boolean).join(" · ")}
            </div>
            <div className="dict-controls">
              <select value={d.role} onChange={e => db.dictionaries.update(d.id!, { role: e.target.value as Role })} aria-label={`Uso de ${d.title}`}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <label className="toggle">
                <input type="checkbox" checked={d.enabled} onChange={e => db.dictionaries.update(d.id!, { enabled: e.target.checked })} />
                Activo
              </label>
              <button className="text danger" onClick={() => onDelete(d.id!, d.title)}>Borrar</button>
            </div>
          </li>
        ))}
      </ul>

      <p className="hint">Espacio usado: {formatMB(usage.usage)} de {formatMB(usage.quota)}. Guarda los .zip en Archivos por si iOS borra los datos.</p>
    </div>
  );
}
