"""
Copias de seguridad de la PWA: historial, palabras añadidas, ajustes y preferencias de diccionarios.

iOS puede borrar los datos de una app web que lleva tiempo sin abrirse, y una web no puede guardar
archivos por su cuenta: por eso la copia automática viene aquí. Son JSON pequeños (decenas de KB);
se guardan las últimas MAX_COPIAS junto a la colección, en data/copias/.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

MAX_COPIAS = 30
#: Tope por copia. El historial de la PWA se recorta a 300 entradas: esto deja margen de sobra.
MAX_BYTES = 5 * 1024 * 1024


def directorio(collection_path: Path) -> Path:
    return collection_path.parent / "copias"


def guardar(collection_path: Path, copia: dict) -> dict:
    """Escribe la copia con la fecha en el nombre y borra las más antiguas que sobren."""
    carpeta = directorio(collection_path)
    carpeta.mkdir(parents=True, exist_ok=True)
    ahora = datetime.now(timezone.utc)
    ruta = carpeta / f"kotodex-{ahora:%Y%m%d-%H%M%S}.json"
    contenido = json.dumps(copia, ensure_ascii=False, separators=(",", ":"))
    # Se escribe aparte y se renombra: un corte a medias no deja una copia rota como «la última».
    temporal = ruta.with_suffix(".tmp")
    temporal.write_text(contenido, encoding="utf-8")
    temporal.replace(ruta)
    for vieja in sorted(carpeta.glob("kotodex-*.json"))[:-MAX_COPIAS]:
        vieja.unlink(missing_ok=True)
    return {"guardada": ruta.name, "bytes": len(contenido.encode("utf-8")), "fecha": ahora.isoformat()}


def ultima(collection_path: Path) -> dict | None:
    """La copia más reciente, o None si no hay ninguna."""
    copias = sorted(directorio(collection_path).glob("kotodex-*.json"))
    if not copias:
        return None
    return json.loads(copias[-1].read_text(encoding="utf-8"))
