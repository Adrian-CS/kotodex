// Un único reproductor de audio para toda la app.
//
// iOS solo deja sonar un <audio> si se le dio play() dentro de un toque del usuario. Aquí el audio
// llega DESPUÉS del toque (hay que pedirlo al servidor), así que en el propio toque se reproduce
// una décima de silencio: eso «desbloquea» el elemento, y cuando llega el audio de verdad se le
// cambia la fuente al mismo elemento y ya puede sonar.

/** 10 ms de silencio en WAV: lo mínimo para que iOS cuente el play() como iniciado por el usuario. */
const SILENCIO = "data:audio/wav;base64,UklGRpYDAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YXIDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

let elemento: HTMLAudioElement | null = null;
/** El play() del silencio. Se espera antes de cambiar la fuente: cortarlo a medias (AbortError)
 *  podría dejar el elemento sin desbloquear en iOS. Dura 10 ms. */
let desbloqueo: Promise<void> = Promise.resolve();

/** Llamar DENTRO del manejador del toque, antes de cualquier await. */
export function prepararAudio(): HTMLAudioElement {
  elemento ??= new Audio();
  elemento.src = SILENCIO;
  desbloqueo = elemento.play().catch(() => { /* si no se desbloquea, reproducir() lo dirá */ });
  return elemento;
}

/** Reproduce una URL en el elemento ya desbloqueado. Resuelve cuando termina de sonar. */
export async function reproducir(url: string): Promise<void> {
  await desbloqueo;
  const a = elemento ?? (elemento = new Audio());
  a.src = url;
  return new Promise((resolver, rechazar) => {
    a.onended = () => resolver();
    a.onerror = () => rechazar(new Error("audio"));
    a.play().catch(rechazar);
  });
}
