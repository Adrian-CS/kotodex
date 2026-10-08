// Orden de trazos de un kanji, desde KanjiVG (CC BY-SA 3.0, kanjivg.tagaini.net).
//
// No se importa nada: cada SVG (~5 KB) se pide a GitHub la primera vez que se abre la ficha de ese
// kanji y se guarda con la Cache API, así que lo ya visto funciona sin conexión. La alternativa,
// importar los ~11.000 SVG, ocuparía 15–20 MB en el iPhone para kanji que casi nunca se abren.
//
// Del SVG solo se sacan los trazados y la posición de los números: la ficha dibuja su propio SVG
// con esos datos. Nunca se inserta el SVG descargado tal cual en la página.

const ORIGEN = "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/";
const CACHE = "kanjivg-v1";

export interface Trazos {
  /** Atributo `d` de cada trazo, en el orden en que se escriben. */
  trazos: string[];
  /** Dónde va el número de cada trazo (coordenadas del viewBox 109×109). */
  numeros: { x: number; y: number }[];
}

const enMemoria = new Map<string, Promise<Trazos | null>>();

/** 懐 → 061d0: KanjiVG nombra los archivos por el código Unicode con cinco cifras. */
const archivo = (kanji: string) => kanji.codePointAt(0)!.toString(16).padStart(5, "0") + ".svg";

async function descargar(url: string): Promise<string | null> {
  // La Cache API puede no estar (contexto no seguro) o fallar (almacenamiento lleno): entonces se
  // descarga sin guardar, que sigue siendo mejor que no enseñar nada.
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { /* sin caché */ }
  const guardada = await cache?.match(url).catch(() => undefined);
  if (guardada) return guardada.text();

  const respuesta = await fetch(url);
  if (respuesta.status === 404) return null;          // KanjiVG no tiene este kanji
  if (!respuesta.ok) throw new Error(`KanjiVG respondió ${respuesta.status}`);
  await cache?.put(url, respuesta.clone()).catch(() => {});
  return respuesta.text();
}

function leer(svg: string): Trazos | null {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  // Los trazos son los <path> con id «kvg:061d0-s1», «-s2»…; el orden del documento es el de escritura.
  const trazos = [...doc.querySelectorAll("path")]
    .filter(p => /-s\d+$/.test(p.getAttribute("id") ?? ""))
    .map(p => p.getAttribute("d") ?? "")
    .filter(Boolean);
  if (!trazos.length) return null;
  // Los números van en <text transform="matrix(1 0 0 1 x y)">n</text>.
  const numeros = [...doc.querySelectorAll("text")].map(t => {
    const m = (t.getAttribute("transform") ?? "").match(/matrix\(1 0 0 1 ([\d.]+) ([\d.]+)\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  }).filter((n): n is { x: number; y: number } => n !== null);
  return { trazos, numeros: numeros.length === trazos.length ? numeros : [] };
}

/**
 * Trazos del kanji, o null si KanjiVG no lo tiene. Lanza si no se pudo descargar (sin conexión
 * y sin copia guardada), para que la ficha lo diga en vez de quedarse en blanco.
 */
export function trazosKanji(kanji: string): Promise<Trazos | null> {
  let pendiente = enMemoria.get(kanji);
  if (!pendiente) {
    pendiente = descargar(ORIGEN + archivo(kanji)).then(svg => (svg ? leer(svg) : null));
    // Un fallo de red no se queda en memoria: al volver a abrir la ficha se reintenta.
    pendiente.catch(() => enMemoria.delete(kanji));
    enMemoria.set(kanji, pendiente);
  }
  return pendiente;
}
