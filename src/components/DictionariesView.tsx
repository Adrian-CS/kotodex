import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Role } from "../db";
import { deleteDictionary, importDictionary, type ImportProgress } from "../importer";
import type { T } from "../i18n";

const ROLES: { value: Role; clave: "role.ja" }[] = [
  { value: "ja", clave: "role.ja" },
  { value: "es", clave: "role.es" as "role.ja" },
  { value: "en", clave: "role.en" as "role.ja" },
  { value: "pitch", clave: "role.pitch" as "role.ja" },
  { value: "other", clave: "role.other" as "role.ja" },
];

const formatMB = (bytes?: number) => (bytes == null ? "—" : `${(bytes / 1024 / 1024).toFixed(0)} MB`);

interface Props { t: T; locale: string }

export function DictionariesView({ t, locale }: Props) {
  const dicts = useLiveQuery(
    async () => {
      const todos = await db.dictionaries.toArray();
      // Menor "order" = más prioridad. Los importados antes de tener el campo van por id.
      return todos.sort((a, b) => (a.order ?? a.id!) - (b.order ?? b.id!) || a.id! - b.id!);
    },
    [],
  );
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ usage?: number; quota?: number }>({});
  const [borrando, setBorrando] = useState<string | null>(null);

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
    if (!confirm(t("dicts.confirmDelete", { title }))) return;
    setError(null);
    setBorrando(t("dicts.deleting", { title }));
    try {
      // Un diccionario grande tarda: se va enseñando cuánto lleva.
      await deleteDictionary(id, n => setBorrando(t("dicts.deletingCount", { title, count: n.toLocaleString(locale) })));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBorrando(null);
    }
  }

  /** Sube o baja un diccionario en la lista de prioridad intercambiando su orden con el vecino. */
  async function mover(indice: number, salto: -1 | 1) {
    if (!dicts) return;
    const vecino = indice + salto;
    if (vecino < 0 || vecino >= dicts.length) return;
    const a = dicts[indice], b = dicts[vecino];
    await db.transaction("rw", db.dictionaries, async () => {
      await db.dictionaries.update(a.id!, { order: b.order ?? b.id! });
      await db.dictionaries.update(b.id!, { order: a.order ?? a.id! });
    });
  }

  const busy = progress !== null || borrando !== null;

  return (
    <div className="page">
      <h1>{t("dicts.title")}</h1>
      <p className="hint">
        {t("dicts.hint")}
      </p>

      <label className={`primary file-button${busy ? " disabled" : ""}`}>
        {busy ? t("dicts.importing") : t("dicts.import")}
        <input type="file" accept=".zip,application/zip" multiple disabled={busy} onChange={e => { onFiles(e.target.files); e.target.value = ""; }} hidden />
      </label>

      {progress && (
        <div className="progress" role="status">
          <div>{progress.stage}</div>
          <progress value={progress.done} max={progress.total} />
        </div>
      )}
      {borrando && <p className="hint" role="status">{borrando}</p>}
      {error && <p className="error">{error}</p>}

      <ul className="dict-list">
        {dicts?.map((d, i) => (
          <li key={d.id} className="dict-item">
            <div className="dict-title">
              <span className="dict-orden">
                <button className="text" disabled={i === 0} aria-label={t("dicts.up", { title: d.title })}
                  onClick={() => mover(i, -1)}>↑</button>
                <button className="text" disabled={i === (dicts?.length ?? 0) - 1} aria-label={t("dicts.down", { title: d.title })}
                  onClick={() => mover(i, 1)}>↓</button>
              </span>
              {d.title}
            </div>
            <div className="dict-meta">
              {[
                d.terms > 0 && t("dicts.terms", { count: d.terms.toLocaleString(locale) }),
                // Saber si un diccionario trae pitch es lo primero que se mira cuando no aparece.
                d.pitches ? t("dicts.pitches", { count: d.pitches.toLocaleString(locale) }) : null,
                d.metas > 0 && t("dicts.metas", { count: d.metas.toLocaleString(locale) }),
              ].filter(Boolean).join(" · ")}
            </div>
            <div className="dict-controls">
              <select value={d.role} onChange={e => db.dictionaries.update(d.id!, { role: e.target.value as Role })} aria-label={t("dicts.roleOf", { title: d.title })}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{t(r.clave)}</option>)}
              </select>
              <label className="toggle">
                <input type="checkbox" checked={d.enabled} onChange={e => db.dictionaries.update(d.id!, { enabled: e.target.checked })} />
                {t("dicts.active")}
              </label>
              <button className="text danger" disabled={busy} onClick={() => onDelete(d.id!, d.title)}>{t("dicts.delete")}</button>
            </div>
          </li>
        ))}
      </ul>

      <p className="hint">{t("dicts.storage", { used: formatMB(usage.usage), quota: formatMB(usage.quota) })}</p>
    </div>
  );
}
