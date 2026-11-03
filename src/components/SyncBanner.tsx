import { useEffect, useState } from "react";
import { descargaCompleta, health, ServerError, sync } from "../server";
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
  // «sync_completo»: la colección del SERVIDOR necesita una descarga completa. Se ofrece aquí.
  const [codigo, setCodigo] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);

  const listo = settings.mode === "server" && !!settings.serverUrl && !!settings.serverToken;

  useEffect(() => {
    if (!listo) { setAviso(null); return; }
    let cancelado = false;
    health(settings)
      .then(h => {
        if (cancelado) return;
        const resultado = h.autosync?.ultimo_resultado ?? "";
        setCodigo(h.autosync?.ultimo_codigo ?? null);
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
      setCodigo(e instanceof ServerError ? e.code ?? null : null);
    } finally {
      setReintentando(false);
    }
  }

  async function descargar() {
    if (!confirm(t("sync.confirmDownload"))) return;
    setDescargando(true);
    try {
      const r = await descargaCompleta(settings);
      setAviso(null);
      setCodigo(null);
      setHecho(t("sync.downloaded", { recovered: r.recuperadas }));
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e));
      setCodigo(e instanceof ServerError ? e.code ?? null : null);
    } finally {
      setDescargando(false);
    }
  }

  if (hecho) {
    return (
      <div className="aviso-sync aviso-pendientes" role="status">
        <p>{hecho}</p>
        <div className="aviso-acciones">
          <button className="text" onClick={() => setHecho(null)}>{t("sync.hide")}</button>
        </div>
      </div>
    );
  }

  if (!aviso || oculto) return null;
  const completo = codigo === "sync_completo";

  return (
    <div className="aviso-sync" role="status">
      <p>
        <strong>{t("sync.title")}</strong> {aviso}
      </p>
      <p className="aviso-detalle">{completo ? t("sync.fullDetail") : t("sync.detail")}</p>
      <div className="aviso-acciones">
        {completo && (
          <button className="primary" onClick={descargar} disabled={descargando || reintentando}>
            {descargando ? t("sync.downloading") : t("sync.download")}
          </button>
        )}
        <button onClick={reintentar} disabled={reintentando || descargando}>
          {reintentando ? t("sync.retrying") : t("sync.retry")}
        </button>
        <button className="text" onClick={() => setOculto(true)}>{t("sync.hide")}</button>
      </div>
    </div>
  );
}
