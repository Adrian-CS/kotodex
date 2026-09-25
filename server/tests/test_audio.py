"""
Fuentes HTTP de audio, contra un servidor de prueba de verdad.

Imita al addon «Yomichan Forvo Server»: responde el JSON de Yomitan con la lista de fuentes y
sirve el mp3 en otra ruta.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from app.audio import fetch_audio

MP3 = b"ID3 esto hace de mp3"
peticiones: list[str] = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urlparse(self.path)
        peticiones.append(url.path)

        if url.path == "/audio.mp3":
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(MP3)))
            self.end_headers()
            self.wfile.write(MP3)
            return

        if url.path == "/":
            term = parse_qs(url.query).get("term", [""])[0]
            cuerpo = json.dumps(
                {"type": "audioSourceList", "audioSources":
                    [{"url": f"http://127.0.0.1:{self.server.server_port}/audio.mp3", "name": "Prueba"}]}
                if term == "食べる" else {"type": "audioSourceList", "audioSources": []}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
            return

        self.send_response(404)
        self.end_headers()


@pytest.fixture(scope="module")
def servidor():
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    hilo = threading.Thread(target=httpd.serve_forever, daemon=True)
    hilo.start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


def test_descarga_por_lista_de_fuentes(servidor, tmp_path):
    peticiones.clear()
    urls = (servidor + "/?term={expression}&reading={reading}",)
    path = fetch_audio(urls, tmp_path, "食べる", "たべる", 10.0)

    assert path is not None
    assert path.read_bytes() == MP3
    # El nombre acaba siendo el del fichero en la media de Anki, así que tiene que ser legible.
    assert path.name == "食べる - たべる.mp3"


def test_segunda_vez_sale_de_la_cache(servidor, tmp_path):
    urls = (servidor + "/?term={expression}&reading={reading}",)
    assert fetch_audio(urls, tmp_path, "食べる", "たべる", 10.0) is not None
    peticiones.clear()
    path = fetch_audio(urls, tmp_path, "食べる", "たべる", 10.0)
    assert path is not None
    assert peticiones == [], "con la caché llena no debería salir a la red"


def test_sin_resultados_devuelve_none(servidor, tmp_path):
    urls = (servidor + "/?term={expression}&reading={reading}",)
    assert fetch_audio(urls, tmp_path, "存在しない", "そんざいしない", 10.0) is None


def test_fuente_caida_no_rompe(tmp_path):
    urls = ("http://127.0.0.1:9/?term={expression}",)
    assert fetch_audio(urls, tmp_path, "橋", "はし", 1.0) is None


def test_sin_fuentes_configuradas(tmp_path):
    assert fetch_audio((), tmp_path, "橋", "はし", 10.0) is None
