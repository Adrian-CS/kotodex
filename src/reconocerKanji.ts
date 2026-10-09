// Reconocimiento de kanji dibujados a mano, sin conexión, con KanjiCanvas (MIT).
//
// Compara los trazos con 2.213 patrones (los jōyō y algunos más) sacados de KanjiCanvas y
// redondeados a enteros: 1,5 MB, ~510 KB comprimidos. Pide el número de trazos aproximadamente
// correcto (admite de −2 a +1) y tolera el orden hasta cierto punto.
//
// Los patrones se descargan la primera vez que se abre el dibujo y se guardan con la Cache API,
// así que después funciona sin conexión. Este módulo y la librería se cargan con import().

import "./vendor/kanji-canvas.js";

/** Un trazo es la lista de puntos [x, y] por los que pasó el dedo, en coordenadas del lienzo. */
export type Trazo = [number, number][];

interface KanjiCanvasApi {
  refPatterns: unknown[];
  momentNormalize(id: string): unknown;
  extractFeatures(patron: unknown, intervalo: number): unknown;
  coarseClassification(rasgos: unknown): unknown;
  fineClassification(rasgos: unknown, candidatos: unknown): string;
  [clave: string]: unknown;
}

const PATRONES = "/kanjicanvas/patrones.json";
const CACHE = "kanjicanvas-v1";

let preparado: Promise<KanjiCanvasApi> | null = null;

async function descargarPatrones(): Promise<unknown[]> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { /* sin Cache API: se descarga sin guardar */ }
  const guardada = await cache?.match(PATRONES).catch(() => undefined);
  if (guardada) return guardada.json();
  const respuesta = await fetch(PATRONES);
  if (!respuesta.ok) throw new Error(`patrones: ${respuesta.status}`);
  await cache?.put(PATRONES, respuesta.clone()).catch(() => {});
  return respuesta.json();
}

/** Carga los patrones (una vez). Llamarlo al abrir el dibujo adelanta la descarga. */
export function prepararReconocedor(): Promise<KanjiCanvasApi> {
  if (!preparado) {
    preparado = descargarPatrones().then(patrones => {
      const kc = (window as unknown as { KanjiCanvas: KanjiCanvasApi }).KanjiCanvas;
      kc.refPatterns = patrones;
      return kc;
    });
    // Si falla (sin conexión la primera vez), se reintenta al volver a abrir.
    preparado.catch(() => { preparado = null; });
  }
  return preparado;
}

/** Los kanji más parecidos a lo dibujado, el mejor primero (hasta 10). */
export async function reconocer(trazos: Trazo[]): Promise<string[]> {
  if (!trazos.length) return [];
  const kc = await prepararReconocedor();
  // KanjiCanvas guarda los trazos por id de lienzo; aquí se le dan directamente, sin su lienzo.
  kc["recordedPattern_kotodex"] = trazos;
  const normalizado = kc.momentNormalize("kotodex");
  const rasgos = kc.extractFeatures(normalizado, 20);
  const candidatos = kc.coarseClassification(rasgos);
  return kc.fineClassification(rasgos, candidatos).split(/\s+/).filter(Boolean);
}
