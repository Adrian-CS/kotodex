import { useEffect, useState } from "react";
import { health, sync } from "../server";
import type { Settings } from "../settings";
import type { T } from "../i18n";

interface Props { settings: Settings; t: T }

/**
 * Banda de aviso cuando la última sincronización automática falló.
 *
 * El servidor ya avisa por correo o ntfy, pero eso hay que configurarlo. Esto se ve siempre, y en
 * el momento que importa: al abrir el diccionario, antes de ponerse a añadir tarjetas que se van a
 * quedar atascadas en el servidor.
 */
export function SyncBanner({ settings, t }: Props) {
  const [aviso, setAviso] = useState<string | null>(null);
  const [oculto, setOculto] = useState(false);
  const [reintentando, setReintentando] = useState(false);

  const listo = settings.mode === "server" && !!settings.serverUrl && !!settings.serverToken;

  useEffect(() => {
    if (!listo) { setAviso(null); return; }
    let cancelado = false;
    health(settings)
      .then(h => {
        if (cancelado) return;
        const resultado = h.autosync?.ultimo_resultado ?? "";
        // El prefijo «error:» es del registro del servidor; aquí sobra.
        setAviso(resultado.startsWith("error") ? resultado.replace(/^error[^:]*:\s*/, "") : null);
      })
      .catch(() => { /* si el servidor no responde ya se ve al añadir una tarjeta */ });
    return () => { cancelado = true; };
    // Solo depende de la conexión: no hace falta reconsultar por cambiar de mazo o de etiquetas.
  }, [listo, settings.serverUrl, settings.serverToken]);

  async function reintentar() {
    setReintentando(true);
    try {
      await sync(settings);
      setAviso(null);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e));
    } finally {
      setReintentando(false);
    }
  }

  if (!aviso || oculto) return null;

  return (
    <div className="aviso-sync" role="status">
      <p>
        <strong>{t("sync.title")}</strong> {aviso}
      </p>
      <p className="aviso-detalle">{t("sync.detail")}</p>
      <div className="aviso-acciones">
        <button onClick={reintentar} disabled={reintentando}>
          {reintentando ? t("sync.retrying") : t("sync.retry")}
        </button>
        <button className="text" onClick={() => setOculto(true)}>{t("sync.hide")}</button>
      </div>
    </div>
  );
}
