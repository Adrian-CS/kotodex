"""
Audio de Wikimedia Commons: las grabaciones de Lingua Libre, voces humanas con licencia libre
(CC BY-SA). Es la misma fuente que ofrece Yomitan («Lingua Libre»).

Va detrás de las fuentes configuradas y delante de VOICEVOX: si alguien grabó la palabra, suena una
persona; si no, la voz sintética de siempre. Las palabras comunes suelen estar, las raras no.

Los ficheros se llaman «LL-Q5287 (jpn)-Hablante-猫.wav» (Q5287 = japonés en Wikidata) y están en la
categoría «Lingua_Libre_pronunciation-jpn». Son dos consultas a la API: buscar el título y pedir la
URL del fichero. Lo descargado va a la caché de audio como todo lo demás, así que cada palabra se
pide una sola vez.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import requests

from .audio import CONTENT_TYPES, MAX_BYTES, guardar_en_cache

log = logging.getLogger("kotodex.commons")

API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia pide un User-Agent que identifique al cliente.
AGENTE = "kotodex/1.0 (diccionario personal; https://github.com/Adrian-CS/kotodex)"
CATEGORIA = "Lingua_Libre_pronunciation-jpn"


def _titulo_valido(titulo: str, termino: str) -> bool:
    """
    «File:LL-Q5287 (jpn)-Hablante-猫.wav», con el término ENTERO detrás del último guion: así buscar
    母さん no se queda con la grabación de お母さん.
    """
    return re.fullmatch(rf"File:LL-Q\d+\s+\(jpn\)-.+-{re.escape(termino)}\.wav", titulo, re.IGNORECASE) is not None


def buscar_commons(
    expression: str,
    reading: str,
    cache_dir: Path,
    timeout: float,
    api: str = API,
) -> Path | None:
    """La grabación de la palabra, ya en la caché; None si no hay o Commons no responde."""
    termino = expression.strip()
    # Solo por la expresión: buscar por la lectura (はし) podría traer la grabación de otra palabra (橋 por 箸).
    if not termino or any(c in termino for c in '/\\"'):
        return None
    sesion = requests.Session()
    sesion.headers.update({"User-Agent": AGENTE})
    try:
        busqueda = sesion.get(api, timeout=timeout, params={
            "action": "query", "format": "json", "list": "search", "srnamespace": 6, "srlimit": 10,
            "srsearch": f'intitle:/-{re.escape(termino)}\\.wav/i incategory:"{CATEGORIA}"',
        })
        busqueda.raise_for_status()
        titulos = [r["title"] for r in busqueda.json().get("query", {}).get("search", [])
                   if _titulo_valido(r.get("title", ""), termino)]
        if not titulos:
            return None

        info = sesion.get(api, timeout=timeout, params={
            "action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url",
            "titles": "|".join(titulos[:5]),
        })
        info.raise_for_status()
        paginas = info.json().get("query", {}).get("pages", {}).values()
        # El orden de la búsqueda (relevancia), no el de las páginas, que viene por id.
        urls = {p.get("title"): (p.get("imageinfo") or [{}])[0].get("url") for p in paginas}
        for titulo in titulos[:5]:
            url = urls.get(titulo)
            if not url:
                continue
            fichero = sesion.get(url, timeout=timeout * 2)
            fichero.raise_for_status()
            tipo = fichero.headers.get("Content-Type", "").split(";")[0].strip().lower()
            sufijo = CONTENT_TYPES.get(tipo, ".wav")
            if not fichero.content or len(fichero.content) > MAX_BYTES:
                continue
            return guardar_en_cache(cache_dir, expression, reading, fichero.content, sufijo)
    except (requests.RequestException, ValueError) as e:
        log.info("Wikimedia Commons no respondió para %s: %s", termino, e)
    return None
