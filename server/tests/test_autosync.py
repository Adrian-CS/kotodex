"""
Sincronización automática y avisos.

Lo que importa aquí es que un sync fallido avise una vez y no cada cinco minutos, y que el aviso
lleve las instrucciones, no solo el error.
"""

from __future__ import annotations

import dataclasses
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app import notify
from app.anki_service import ServiceError
from app.autosync import AutoSync
from app.config import load_settings

recibidos: list[str] = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        largo = int(self.headers.get("Content-Length", 0))
        recibidos.append(self.rfile.read(largo).decode("utf-8"))
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()


@pytest.fixture(scope="module")
def webhook():
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}/aviso"
    httpd.shutdown()


class ServicioQueFalla:
    def __init__(self, error: Exception | None):
        self.error = error
        self.veces = 0

    def sync(self, *, wait_media: bool):
        self.veces += 1
        if self.error:
            raise self.error
        return {"required": "NO_CHANGES", "server_message": "", "media": "en curso"}


@pytest.fixture(autouse=True)
def limpiar():
    recibidos.clear()
    notify._ultimo.clear()


def ajustes(webhook_url: str, tmp_path):
    base = load_settings()
    return dataclasses.replace(
        base,
        notify_webhook=webhook_url,
        smtp_host="",
        smtp_to="",
        sync_every_hours=12,
        collection_path=tmp_path / "collection.anki2",
    )


def test_sync_ok_no_avisa(webhook, tmp_path):
    s = ajustes(webhook, tmp_path)
    auto = AutoSync(ServicioQueFalla(None), s)
    auto._sincronizar()
    assert auto.ultimo_resultado.startswith("ok")
    assert recibidos == []


def test_409_avisa_con_instrucciones(webhook, tmp_path):
    s = ajustes(webhook, tmp_path)
    error = ServiceError("AnkiWeb pide una sincronización completa (FULL_SYNC).", status=409)
    auto = AutoSync(ServicioQueFalla(error), s)
    auto._sincronizar()

    assert len(recibidos) == 1
    aviso = recibidos[0]
    assert "kotodex" in aviso
    # El aviso tiene que decir qué hacer, no solo qué ha pasado.
    assert "clone-desktop-collection.ps1" in aviso
    assert "FULL_SYNC" in aviso
    assert "sigue creando tarjetas" in aviso


def test_no_repite_el_mismo_aviso(webhook, tmp_path):
    s = ajustes(webhook, tmp_path)
    auto = AutoSync(ServicioQueFalla(ServiceError("fallo", status=409)), s)
    auto._sincronizar()
    auto._sincronizar()
    auto._sincronizar()
    assert len(recibidos) == 1, "solo debería avisar una vez por ventana de silencio"


def test_error_inesperado_no_mata_el_hilo(webhook, tmp_path):
    s = ajustes(webhook, tmp_path)
    auto = AutoSync(ServicioQueFalla(RuntimeError("algo raro")), s)
    auto._sincronizar()   # no debe propagar
    assert "inesperado" in auto.ultimo_resultado


def test_sin_credenciales_no_arranca(tmp_path):
    s = dataclasses.replace(load_settings(), ankiweb_username="", ankiweb_password="",
                            collection_path=tmp_path / "c.anki2")
    auto = AutoSync(ServicioQueFalla(None), s)
    auto.start()
    assert auto._hilo is None


def test_desactivado_con_cero(tmp_path):
    s = dataclasses.replace(load_settings(), sync_every_hours=0,
                            collection_path=tmp_path / "c.anki2")
    auto = AutoSync(ServicioQueFalla(None), s)
    auto.start()
    assert auto._hilo is None
    assert auto.proximo_en_segundos is None


def test_health_informa_del_autosync(client):
    datos = client.get("/health").json()
    assert "autosync" in datos
    assert "ultimo_resultado" in datos["autosync"]
