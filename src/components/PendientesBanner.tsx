import { usePendientes } from "../pendientes";
import type { Settings } from "../settings";
import type { T } from "../i18n";

interface Props { settings: Settings; t: T }

/** Aviso de tarjetas sin enviar: cuántas, cuáles, y un botón para reintentar ya. */
export function PendientesBanner({ settings, t }: Props) {
  const { pendientes, reintentar, enviandoAhora } = usePendientes(settings);
  if (!pendientes.length) return null;
  const error = pendientes.find(p => p.error)?.error;

  return (
    <div className="aviso-sync aviso-pendientes" role="status">
      <p>
        <strong>{t("queue.title", { count: pendientes.length })}</strong>{" "}
        <span lang="ja">{pendientes.slice(0, 6).map(p => p.expression).join("、")}{pendientes.length > 6 ? "…" : ""}</span>
      </p>
      <p className="aviso-detalle">{error ? t("queue.error", { error }) : t("queue.detail")}</p>
      <div className="aviso-acciones">
        <button onClick={reintentar} disabled={enviandoAhora}>
          {enviandoAhora ? t("queue.sending") : t("queue.retry")}
        </button>
      </div>
    </div>
  );
}
