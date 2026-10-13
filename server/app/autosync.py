"""
Sincronización automática cada X horas, en un hilo aparte.

Ojo con lo que esto sí y no resuelve: sincronizar a menudo evita que se te olvide y reduce la
ventana en la que las colecciones divergen, pero NO evita los 409 de «hace falta sincronización
completa». Eso lo provoca un cambio de esquema en cualquier dispositivo (tocar campos de un tipo
de nota, «Check Database», restaurar una copia), no la cantidad de cambios. Cuando pase, el aviso
te dice qué hacer.

La marca del último sync se guarda en disco, así que reiniciar el servidor no reinicia la cuenta.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from .anki_service import AnkiService, ServiceError
from .config import Settings
from .notify import notificar

log = logging.getLogger("kotodex.autosync")

# Con altas seguidas el sync se va retrasando, pero no más que esto desde la primera.
MAX_ESPERA = 300.0

INSTRUCCIONES = """\
La sincronización automática con AnkiWeb se ha parado y necesita que intervengas.

Qué ha pasado:
  {error}

Qué hacer:
  1. Abre Anki en el ordenador y sincroniza. Te preguntará en qué dirección
     (subir o bajar); elige la que tenga lo bueno.
  2. Sincroniza también AnkiMobile en el iPhone.
  3. Para el servidor kotodex y clona otra vez la colección de escritorio:
       cd C:\\dev\\kotodex\\server
       .\\deploy\\windows\\clone-desktop-collection.ps1
  4. Arranca el servidor. Vuelve a sincronizar solo.

Mientras tanto la PWA sigue creando tarjetas: se quedan en la colección del
servidor y subirán cuando esto se arregle.
"""


class AutoSync:
    def __init__(self, service: AnkiService, settings: Settings):
        self.service = service
        self.settings = settings
        self._parar = threading.Event()
        self._despertar = threading.Event()
        self._cerrojo = threading.Lock()
        # Sync pendiente por notas añadidas (hora de reloj) y cuándo se añadió la primera de la ráfaga.
        self._sync_tras_anadir: float | None = None
        self._primera_pendiente: float | None = None
        self._hilo: threading.Thread | None = None
        self._estado = Path(settings.collection_path).parent / "autosync.json"
        self.ultimo_resultado: str = "todavía no se ha ejecutado"

    # ---- marca en disco -------------------------------------------------

    def _leer_marca(self) -> float:
        try:
            return float(json.loads(self._estado.read_text(encoding="utf-8"))["ultimo"])
        except Exception:
            return 0.0

    def _escribir_marca(self, cuando: float) -> None:
        try:
            self._estado.write_text(
                json.dumps({"ultimo": cuando, "iso": datetime.fromtimestamp(cuando, timezone.utc).isoformat()}),
                encoding="utf-8",
            )
        except OSError as e:
            log.warning("No se pudo guardar la marca de autosync: %s", e)

    # ---- ciclo de vida --------------------------------------------------

    @property
    def _periodico(self) -> bool:
        return self.settings.sync_every_hours > 0

    @property
    def _tras_anadir(self) -> bool:
        return self.settings.sync_after_add_seconds > 0

    def start(self) -> None:
        s = self.settings
        if not self._periodico and not self._tras_anadir:
            log.info("Sincronización automática desactivada (KOTODEX_SYNC_EVERY_HOURS y _AFTER_ADD_SECONDS a 0).")
            return
        if not s.can_sync:
            log.warning("Sincronización automática pedida pero faltan las credenciales de AnkiWeb.")
            return
        self._hilo = threading.Thread(target=self._bucle, name="autosync", daemon=True)
        self._hilo.start()
        log.info(
            "Sincronización automática: cada %s h y %s s después de añadir.",
            s.sync_every_hours or "nunca", s.sync_after_add_seconds or "nunca",
        )

    def stop(self) -> None:
        self._parar.set()
        self._despertar.set()
        if self._hilo is not None:
            self._hilo.join(timeout=5)

    def nudge(self) -> float | None:
        """
        Programa una sincronización poco después de añadir una nota, para que al abrir AnkiMobile
        ya esté. Devuelve en cuántos segundos (o None si no hay sync tras añadir).

        Cada nota nueva la vuelve a retrasar, así una ráfaga de altas se resuelve en un solo sync;
        pero nunca más de MAX_ESPERA desde la primera, o añadir sin parar no sincronizaría nunca.
        """
        if not self._tras_anadir or not self.settings.can_sync or self._hilo is None:
            return None
        ahora = time.time()
        with self._cerrojo:
            if self._primera_pendiente is None:
                self._primera_pendiente = ahora
            self._sync_tras_anadir = min(
                ahora + self.settings.sync_after_add_seconds, self._primera_pendiente + MAX_ESPERA
            )
            restante = self._sync_tras_anadir - ahora
        self._despertar.set()
        log.info("Sincronización en %.0f s (nota añadida).", restante)
        return restante

    @property
    def proximo_en_segundos(self) -> float | None:
        candidatos = []
        if self._periodico:
            candidatos.append(self._leer_marca() + self.settings.sync_every_hours * 3600)
        if self._sync_tras_anadir is not None:
            candidatos.append(self._sync_tras_anadir)
        return max(0.0, min(candidatos) - time.time()) if candidatos else None

    # ---- bucle ----------------------------------------------------------

    def _bucle(self) -> None:
        # Un respiro al arrancar: que la colección abra tranquila antes de salir a la red. Una nota
        # añadida en ese rato no espera de más: su sync sale como mucho a los 60 s igualmente.
        if self._parar.wait(min(60, self.settings.sync_after_add_seconds or 60)):
            return
        while not self._parar.is_set():
            espera = self.proximo_en_segundos
            if espera is None or espera > 0:
                # nudge() despierta al hilo para que recalcule; si no, como mucho cada minuto.
                self._despertar.wait(60 if espera is None else min(espera, 60))
                self._despertar.clear()
                continue
            with self._cerrojo:
                self._sync_tras_anadir = None
                self._primera_pendiente = None
            self._sincronizar()

    def _sincronizar(self) -> None:
        try:
            # wait_media=False: la media va por su cuenta en segundo plano y así no se queda
            # el lock de la colección cogido mientras suben ficheros.
            salida = self.service.sync(wait_media=False)
            self.ultimo_resultado = f"ok ({salida['required']})"
            log.info("Sincronización automática: %s", self.ultimo_resultado)
            self._escribir_marca(time.time())
        except ServiceError as e:
            self.ultimo_resultado = f"error: {e}"
            log.error("Sincronización automática fallida: %s", e)
            # Reintentar en una hora en vez de machacar cada 5 minutos.
            self._escribir_marca(time.time() - max(0, (self.settings.sync_every_hours - 1) * 3600))
            notificar(
                self.settings,
                "kotodex: la sincronización con Anki necesita que intervengas",
                INSTRUCCIONES.format(error=e),
                clave="autosync",
            )
        except Exception as e:  # noqa: BLE001 — el hilo no se puede morir
            self.ultimo_resultado = f"error inesperado: {e}"
            log.exception("Sincronización automática: error inesperado")
            self._escribir_marca(time.time() - max(0, (self.settings.sync_every_hours - 1) * 3600))
