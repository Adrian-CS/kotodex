"""
Síntesis de voz con VOICEVOX (motor local, gratuito, https://voicevox.hiroshiba.jp).

Última opción cuando no hay ni pack local ni fuente HTTP. Lo interesante no es que sintetice, sino
que **se le puede imponer el acento tonal**: sin eso, un audio sintético contradiría al gráfico de
pitch de la tarjeta, que es peor que no tener audio.

Son tres peticiones, y la del medio es imprescindible:
  POST /audio_query?text=…&speaker=N   → la consulta, con las moras y el acento que él deduce
  POST /mora_data?speaker=N            → recalcula la ALTURA de cada mora con el acento corregido
  POST /synthesis?speaker=N            → con esa consulta ya arreglada, devuelve el WAV

Sin el paso de /mora_data no sirve de nada tocar `accent`: /synthesis no lo mira, usa el `pitch`
que cada mora trae ya calculado. Cambiar solo `accent` devuelve un audio byte a byte idéntico
(comprobado: 橋 y 箸 sonaban igual).
"""

from __future__ import annotations

import logging

import requests

log = logging.getLogger("kotodex.voicevox")


def _accent_para(downstep: int, moras: int) -> int:
    """
    Traduce la posición de Kanjium a la de VOICEVOX.

    VOICEVOX exige 1 <= accent <= nº de moras, así que no admite el 0 del 平板. No es un problema:
    aislada, una palabra 平板 suena igual que una 尾高 (la diferencia solo aparece en la partícula
    siguiente, que aquí no se sintetiza). Así que el 0 se mapea a la última mora.
    """
    if downstep <= 0 or downstep > moras:
        return moras
    return downstep


def synthesize(
    base_url: str,
    speaker: int,
    text: str,
    downstep: int | None,
    timeout: float,
) -> bytes | None:
    """WAV de la palabra, con el acento corregido si se conoce. None si algo falla."""
    if not base_url or not text.strip():
        return None
    url = base_url.rstrip("/")

    try:
        respuesta = requests.post(
            f"{url}/audio_query", params={"text": text, "speaker": speaker}, timeout=timeout
        )
        respuesta.raise_for_status()
        consulta = respuesta.json()

        if downstep is not None:
            frases = consulta.get("accent_phrases") or []
            if len(frases) == 1:
                moras = len(frases[0].get("moras") or [])
                if moras:
                    frases[0]["accent"] = _accent_para(downstep, moras)
                    # Imprescindible: recalcular la altura de cada mora. Sin esto, /synthesis
                    # ignora el acento nuevo y devuelve exactamente el mismo audio.
                    recalculo = requests.post(
                        f"{url}/mora_data", params={"speaker": speaker}, json=frases, timeout=timeout
                    )
                    recalculo.raise_for_status()
                    consulta["accent_phrases"] = recalculo.json()
            elif frases:
                # Varias frases acentuales: el dato de Kanjium es de la palabra entera y no se
                # sabe repartir, así que se deja el acento que haya deducido VOICEVOX.
                log.info("«%s» se parte en %d frases acentuales: no se toca el acento.", text, len(frases))

        audio = requests.post(
            f"{url}/synthesis",
            params={"speaker": speaker},
            json=consulta,
            timeout=timeout * 3,   # sintetizar tarda más que analizar
        )
        audio.raise_for_status()
        contenido = audio.content
        return contenido if contenido else None
    except (requests.RequestException, ValueError) as e:
        log.warning("VOICEVOX no respondió: %s", e)
        return None
