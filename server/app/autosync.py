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

    def start(self) -> None:
        s = self.settings
        if s.sync_every_hours <= 0:
            log.info("Sincronización automática desactivada (KOTODEX_SYNC_EVERY_HOURS=0).")
            return
        if not s.can_sync:
            log.warning("Sincronización automática pedida pero faltan las credenciales de AnkiWeb.")
            return
        self._hilo = threading.Thread(target=self._bucle, name="autosync", daemon=True)
        self._hilo.start()
        log.info("Sincronización automática cada %s h.", s.sync_every_hours)

    def stop(self) -> None:
        self._parar.set()
        if self._hilo is not None:
            self._hilo.join(timeout=5)

    def nudge(self, delay_seconds: float = 180.0) -> None:
        """
        Adelanta la próxima sincronización tras añadir una nota.

        No sincroniza al momento a propósito: añadir tres palabras seguidas haría tres syncs. Con
        el retraso, una ráfaga de altas se resuelve en uno solo. Nunca la retrasa, solo la adelanta.
        """
        s = self.settings
        if s.sync_every_hours <= 0 or not s.can_sync:
            return
        intervalo = s.sync_every_hours * 3600
        objetivo = time.time() + delay_seconds
        if objetivo < self._leer_marca() + intervalo:
            self._escribir_marca(objetivo - intervalo)
            log.info("Sincronización adelantada: en %.0f s.", delay_seconds)

    @property
    def proximo_en_segundos(self) -> float | None:
        if self.settings.sync_every_hours <= 0:
            return None
        return max(0.0, self._leer_marca() + self.settings.sync_every_hours * 3600 - time.time())

    # ---- bucle ----------------------------------------------------------

    def _bucle(self) -> None:
        # Un respiro al arrancar: que la colección abra tranquila antes de salir a la red.
        if self._parar.wait(60):
            return
        while not self._parar.is_set():
            espera = self.proximo_en_segundos or 0.0
            if espera > 0:
                # Despertar cada minuto como mucho: así se reacciona rápido al apagado y a las
                # sincronizaciones adelantadas por nudge().
                if self._parar.wait(min(espera, 60)):
                    return
                continue
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
