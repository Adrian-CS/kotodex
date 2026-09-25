"""
Síntesis con VOICEVOX, contra un motor de mentira.

Lo que de verdad importa comprobar es que se le impone el acento de Kanjium: un audio sintético
que contradiga al gráfico de pitch de la tarjeta es peor que no tener audio.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from app.voicevox import _accent_para, synthesize

WAV = b"RIFF....WAVEfmt "
# Lo que el motor "deduce" solo: 3 moras y un acento cualquiera que habrá que corregir.
CONSULTA_BASE = {
    "accent_phrases": [
        {"moras": [{"text": "タ"}, {"text": "ベ"}, {"text": "ル"}], "accent": 1, "pause_mora": None}
    ],
    "speedScale": 1.0,
}

recibido: dict = {}


class Motor(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        url = urlparse(self.path)
        params = parse_qs(url.query)
        largo = int(self.headers.get("Content-Length", 0))
        cuerpo = self.rfile.read(largo) if largo else b""

        if url.path == "/audio_query":
            recibido["texto"] = params.get("text", [""])[0]
            recibido["speaker_query"] = params.get("speaker", [""])[0]
            salida = json.dumps(CONSULTA_BASE).encode()
            tipo = "application/json"
        elif url.path == "/synthesis":
            recibido["speaker_synth"] = params.get("speaker", [""])[0]
            recibido["consulta"] = json.loads(cuerpo)
            salida = WAV
            tipo = "audio/wav"
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(salida)))
        self.end_headers()
        self.wfile.write(salida)


@pytest.fixture(scope="module")
def motor():
    httpd = HTTPServer(("127.0.0.1", 0), Motor)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


@pytest.fixture(autouse=True)
def limpiar():
    recibido.clear()


def acento_enviado() -> int:
    return recibido["consulta"]["accent_phrases"][0]["accent"]


def test_sintetiza_y_devuelve_wav(motor):
    assert synthesize(motor, 3, "たべる", None, 5.0) == WAV
    assert recibido["texto"] == "たべる"
    assert recibido["speaker_query"] == "3"
    assert recibido["speaker_synth"] == "3"


def test_sin_downstep_no_toca_el_acento(motor):
    synthesize(motor, 1, "たべる", None, 5.0)
    assert acento_enviado() == 1, "el que traía la consulta original"


def test_impone_el_acento_de_kanjium(motor):
    synthesize(motor, 1, "たべる", 2, 5.0)
    assert acento_enviado() == 2


def test_heiban_va_a_la_ultima_mora(motor):
    # VOICEVOX exige accent >= 1, y aislada una palabra 平板 suena igual que una 尾高.
    synthesize(motor, 1, "たべる", 0, 5.0)
    assert acento_enviado() == 3


def test_downstep_imposible_se_recorta(motor):
    synthesize(motor, 1, "たべる", 9, 5.0)
    assert acento_enviado() == 3


def test_motor_caido_devuelve_none():
    assert synthesize("http://127.0.0.1:9", 1, "たべる", 2, 1.0) is None


def test_sin_url_no_hace_nada():
    assert synthesize("", 1, "たべる", 2, 5.0) is None


def test_texto_vacio_no_hace_nada(motor):
    assert synthesize(motor, 1, "   ", 2, 5.0) is None


@pytest.mark.parametrize(
    ("downstep", "moras", "esperado"),
    [(0, 3, 3), (1, 3, 1), (2, 3, 2), (3, 3, 3), (4, 3, 3), (-1, 3, 3)],
)
def test_traduccion_de_acento(downstep, moras, esperado):
    assert _accent_para(downstep, moras) == esperado
