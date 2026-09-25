import { useEffect, useState } from "react";
import { health, sync } from "../server";
import type { Settings } from "../settings";

interface Props { settings: Settings }

/**
 * Banda de aviso cuando la última sincronización automática falló.
 *
 * El servidor ya avisa por correo o ntfy, pero eso hay que configurarlo. Esto se ve siempre, y en
 * el momento que importa: al abrir el diccionario, antes de ponerse a añadir tarjetas que se van a
 * quedar atascadas en el servidor.
 */
export function SyncBanner({ settings }: Props) {
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
        <strong>La sincronización con Anki necesita que intervengas.</strong> {aviso}
      </p>
      <p className="aviso-detalle">
        Puedes seguir añadiendo tarjetas: se guardan en el servidor y subirán cuando se arregle.
        Sincroniza Anki en el ordenador y vuelve a intentarlo.
      </p>
      <div className="aviso-acciones">
        <button onClick={reintentar} disabled={reintentando}>
          {reintentando ? "Sincronizando…" : "Reintentar"}
        </button>
        <button className="text" onClick={() => setOculto(true)}>Ocultar</button>
      </div>
    </div>
  );
}
