"""
Busca el audio de una palabra en un pack local (JPod101, NHK, Forvo… descargados a disco).

No hay un formato único: cada pack ordena los ficheros a su manera, así que en vez de fijar uno
se configuran patrones con KOTODEX_AUDIO_PATTERNS. En cada patrón se sustituyen {expression} y
{reading}, y el resultado se usa como glob dentro de cada directorio de KOTODEX_AUDIO_DIRS, en
orden: gana el primero que exista. Si no hay directorios configurados, la nota se crea sin audio.
"""

from __future__ import annotations

from pathlib import Path

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
    """Primer fichero de audio que encaje, o None."""
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
