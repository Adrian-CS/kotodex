"""
El módulo app.main lee la configuración al importarse, así que el entorno se prepara aquí antes.
Todo ocurre en un directorio temporal: no toca la colección de verdad.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

TMP = Path(tempfile.mkdtemp(prefix="kotodex-test-"))

NOTETYPE_DIR = TMP / "notetype"
NOTETYPE_DIR.mkdir()
(NOTETYPE_DIR / "front.html").write_text("<div class=\"word\">{{Expression}}</div>", encoding="utf-8")
(NOTETYPE_DIR / "back.html").write_text(
    "{{FrontSide}}<hr id=answer>{{Reading}}{{Audio}}{{Pitch}}{{DefJA}}", encoding="utf-8")
(NOTETYPE_DIR / "style.css").write_text(".card { color: black; }", encoding="utf-8")

AUDIO_DIR = TMP / "audio"
AUDIO_DIR.mkdir()
(AUDIO_DIR / "食べる - たべる.mp3").write_bytes(b"no es un mp3 de verdad")

TOKEN = "token-de-prueba-muy-largo"

os.environ.update(
    KOTODEX_TOKEN=TOKEN,
    KOTODEX_COLLECTION=str(TMP / "data" / "collection.anki2"),
    KOTODEX_NOTETYPE_DIR=str(NOTETYPE_DIR),
    KOTODEX_AUDIO_DIRS=str(AUDIO_DIR),
    KOTODEX_DEFAULT_DECK="日本語",
    KOTODEX_CORS_ORIGINS="https://kotodex.pages.dev",
)


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {TOKEN}"})
        yield c
