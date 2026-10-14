"""Grabaciones de Lingua Libre (Wikimedia Commons), contra una API falsa con la misma forma."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from app.commons import _titulo_valido, buscar_commons

WAV = b"RIFF esto hace de wav"
peticiones: list[dict] = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _responder(self, cuerpo: bytes, tipo: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/fichero.wav":
            return self._responder(WAV, "audio/x-wav")
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        peticiones.append(q)
        if q.get("list") == "search":
            # Devuelve también un título parecido que NO es la palabra (お母さん al buscar 母さん).
            titulos = ["File:LL-Q5287 (jpn)-Alguien-お母さん.wav"]
            if "猫" in q["srsearch"]:
                titulos.insert(0, "File:LL-Q5287 (jpn)-Higa4-猫.wav")
            datos = {"query": {"search": [{"title": t} for t in titulos]}}
        else:
            base = f"http://127.0.0.1:{self.server.server_port}"
            datos = {"query": {"pages": {str(i): {"title": t, "imageinfo": [{"url": f"{base}/fichero.wav"}]}
                                         for i, t in enumerate(q["titles"].split("|"))}}}
        self._responder(json.dumps(datos).encode(), "application/json")


@pytest.fixture(scope="module")
def api():
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}/w/api.php"
    httpd.shutdown()


def test_descarga_la_grabacion_a_la_cache(api, tmp_path):
    peticiones.clear()
    path = buscar_commons("猫", "ねこ", tmp_path, 5.0, api=api)
    assert path is not None
    assert path.read_bytes() == WAV
    assert path.name == "猫 - ねこ.wav"
    # Busca en la categoría de Lingua Libre en japonés.
    assert 'incategory:"Lingua_Libre_pronunciation-jpn"' in peticiones[0]["srsearch"]


def test_no_coge_otra_palabra_que_la_contenga(api, tmp_path):
    assert buscar_commons("母さん", "かあさん", tmp_path, 5.0, api=api) is None


def test_commons_caido_no_rompe(tmp_path):
    assert buscar_commons("猫", "ねこ", tmp_path, 1.0, api="http://127.0.0.1:9/w/api.php") is None


def test_titulo_valido():
    assert _titulo_valido("File:LL-Q5287 (jpn)-Higa4-猫.wav", "猫")
    assert _titulo_valido("File:LL-Q5287 (jpn)-Un-nombre-con-guiones-猫.wav", "猫")
    assert not _titulo_valido("File:LL-Q5287 (jpn)-Alguien-子猫.wav", "猫")
    assert not _titulo_valido("File:LL-Q150 (fra)-Alguien-猫.wav", "猫")
