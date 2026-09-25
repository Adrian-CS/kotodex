"""
Busca el audio de una palabra. Dos fuentes, en este orden:

1. Un pack local en disco (KOTODEX_AUDIO_DIRS). No hay un formato único: cada pack ordena los
   ficheros a su manera, así que la búsqueda se configura con patrones (KOTODEX_AUDIO_PATTERNS),
   donde se sustituyen {expression} y {reading} y el resultado se usa como glob.

2. Fuentes HTTP (KOTODEX_AUDIO_URLS), plantillas de URL con {expression} y {reading}. Sirve tanto
   para un servidor de audio local como para una API con clave. Entiende dos tipos de respuesta:
   el audio directamente, o el JSON de Yomitan {"audioSources":[{"url":…}]}, del que se baja el
   primero. Lo descargado se guarda en la caché, así que cada palabra se pide una sola vez y con
   el tiempo la caché acaba siendo tu propio pack.

Sin nada configurado, las notas se crean sin audio.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

import requests

# Suficiente para los packs habituales; se puede cambiar sin tocar el código.
DEFAULT_PATTERNS: tuple[str, ...] = (
    "{expression} - {reading}.*",
    "{expression}_{reading}.*",
    "{expression}/{reading}.*",
    "{reading}/{expression}.*",
    "{expression}.*",
    "{reading}.*",
)

AUDIO_SUFFIXES = {".mp3", ".ogg", ".opus", ".m4a", ".aac", ".wav", ".flac"}

CONTENT_TYPES = {
    "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/ogg": ".ogg", "audio/opus": ".opus",
    "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/flac": ".flac",
}

MAX_BYTES = 5 * 1024 * 1024

# La expresión y la lectura vienen de fuera: no pueden salirse del directorio del pack.
_FORBIDDEN = ("/", "\\", "..", "\0")


def _safe(value: str) -> str | None:
    value = value.strip()
    if not value or any(bad in value for bad in _FORBIDDEN):
        return None
    return value


def find_audio(
    dirs: tuple[Path, ...],
    patterns: tuple[str, ...],
    expression: str,
    reading: str,
) -> Path | None:
    """Primer fichero del pack local que encaje, o None."""
    if not dirs:
        return None
    safe_expression = _safe(expression)
    safe_reading = _safe(reading) or safe_expression
    if not safe_expression or not safe_reading:
        return None

    for directory in dirs:
        if not directory.is_dir():
            continue
        for pattern in patterns or DEFAULT_PATTERNS:
            glob = pattern.format(expression=safe_expression, reading=safe_reading)
            for match in sorted(directory.glob(glob)):
                if match.is_file() and match.suffix.lower() in AUDIO_SUFFIXES:
                    # El glob puede escaparse con symlinks: comprobar que sigue dentro del pack.
                    try:
                        match.resolve().relative_to(directory.resolve())
                    except ValueError:
                        continue
                    return match
    return None


def _cache_name(expression: str, reading: str) -> str:
    """Nombre legible, porque acaba siendo el nombre del fichero en la media de Anki."""
    return expression if not reading or reading == expression else f"{expression} - {reading}"


def cached_audio(cache_dir: Path, expression: str, reading: str) -> Path | None:
    stem = _cache_name(expression, reading)
    for suffix in AUDIO_SUFFIXES:
        candidate = cache_dir / f"{stem}{suffix}"
        if candidate.is_file():
            return candidate
    return None


def guardar_en_cache(cache_dir: Path, expression: str, reading: str, contenido: bytes, suffix: str) -> Path | None:
    """Deja el audio en la caché con un nombre legible (acaba siendo el de la media de Anki)."""
    stem = _safe(_cache_name(expression, reading))
    if not stem or not contenido:
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{stem}{suffix}"
    path.write_bytes(contenido)
    return path


def _download(session: requests.Session, url: str, timeout: float) -> tuple[bytes, str] | None:
    """Devuelve (contenido, extensión) si la URL da audio; None si no."""
    if not url.startswith(("http://", "https://")):
        return None
    response = session.get(url, timeout=timeout, stream=True)
    response.raise_for_status()

    content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
    suffix = CONTENT_TYPES.get(content_type)
    if suffix is None:
        # Algunos servidores no ponen bien el Content-Type: mirar la extensión de la URL.
        url_suffix = Path(url.split("?")[0]).suffix.lower()
        suffix = url_suffix if url_suffix in AUDIO_SUFFIXES else None
    if suffix is None:
        return None

    content = b""
    for chunk in response.iter_content(64 * 1024):
        content += chunk
        if len(content) > MAX_BYTES:
            return None
    return (content, suffix) if content else None


def _audio_url_from_json(payload: bytes) -> str | None:
    """Formato de fuente de audio de Yomitan: {"audioSources":[{"url": …}]}."""
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    sources = data.get("audioSources") if isinstance(data, dict) else None
    if not isinstance(sources, list):
        return None
    for source in sources:
        if isinstance(source, dict) and isinstance(source.get("url"), str):
            return source["url"]
    return None


def fetch_audio(
    urls: tuple[str, ...],
    cache_dir: Path,
    expression: str,
    reading: str,
    timeout: float,
) -> Path | None:
    """Descarga el audio de la primera fuente HTTP que responda, y lo deja en la caché."""
    if not urls:
        return None
    stem = _safe(_cache_name(expression, reading))
    if not stem:
        return None

    cached = cached_audio(cache_dir, expression, reading)
    if cached:
        return cached

    session = requests.Session()
    session.headers.update({"User-Agent": "kotodex/1.0"})
    for template in urls:
        url = template.format(expression=quote(expression), reading=quote(reading))
        try:
            response = session.get(url, timeout=timeout)
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()

            if content_type in CONTENT_TYPES:
                content, suffix = response.content, CONTENT_TYPES[content_type]
                if len(content) > MAX_BYTES:
                    continue
            else:
                # Respuesta con una lista de fuentes: bajar la primera.
                audio_url = _audio_url_from_json(response.content)
                if not audio_url:
                    continue
                downloaded = _download(session, audio_url, timeout)
                if downloaded is None:
                    continue
                content, suffix = downloaded
        except (requests.RequestException, ValueError):
            continue

        cache_dir.mkdir(parents=True, exist_ok=True)
        path = cache_dir / f"{stem}{suffix}"
        path.write_bytes(content)
        return path
    return None
