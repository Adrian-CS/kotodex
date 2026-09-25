"""
Avisos cuando algo necesita que Adrian intervenga (básicamente, un sync que pide arreglo a mano).

Dos vías, se usan las que estén configuradas:
  - Correo por SMTP (KOTODEX_SMTP_*).
  - Webhook: un POST con JSON a una URL (ntfy, Discord, lo que sea). Menos configuración que el
    correo, porque no hace falta contraseña de aplicación.

Nunca lanza: un fallo avisando no puede tumbar el sync.
"""

from __future__ import annotations

import logging
import smtplib
import time
from email.message import EmailMessage

import requests

from .config import Settings

log = logging.getLogger("kotodex.notify")

# No repetir el mismo aviso una y otra vez si el problema dura días.
_ultimo: dict[str, float] = {}
SILENCIO_SEGUNDOS = 12 * 3600


def _repetido(clave: str) -> bool:
    ahora = time.monotonic()
    anterior = _ultimo.get(clave)
    if anterior is not None and ahora - anterior < SILENCIO_SEGUNDOS:
        return True
    _ultimo[clave] = ahora
    return False


def _email(s: Settings, asunto: str, cuerpo: str) -> None:
    mensaje = EmailMessage()
    mensaje["Subject"] = asunto
    mensaje["From"] = s.smtp_from or s.smtp_user
    mensaje["To"] = s.smtp_to
    mensaje.set_content(cuerpo)

    if s.smtp_port == 465:
        servidor = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=30)
    else:
        servidor = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30)
    with servidor:
        if s.smtp_port != 465:
            servidor.starttls()
        if s.smtp_user:
            servidor.login(s.smtp_user, s.smtp_password)
        servidor.send_message(mensaje)


def notificar(s: Settings, asunto: str, cuerpo: str, *, clave: str = "") -> None:
    """Manda el aviso por donde esté configurado. `clave` agrupa avisos para no repetirlos."""
    if clave and _repetido(clave):
        log.info("Aviso «%s» silenciado: ya se mandó hace poco.", clave)
        return

    if s.smtp_host and s.smtp_to:
        try:
            _email(s, asunto, cuerpo)
            log.info("Aviso enviado por correo a %s", s.smtp_to)
        except Exception as e:
            log.warning("No se pudo enviar el correo: %s", e)

    if s.notify_webhook:
        try:
            # Texto plano, que es lo que espera ntfy (y casi cualquier cosa sencilla). La cabecera
            # Title solo si es ASCII: ntfy rechaza cabeceras con acentos.
            cabeceras = {"Content-Type": "text/plain; charset=utf-8"}
            if asunto.isascii():
                cabeceras["Title"] = asunto
            requests.post(
                s.notify_webhook,
                data=f"{asunto}\n\n{cuerpo}".encode(),
                headers=cabeceras,
                timeout=15,
            ).raise_for_status()
            log.info("Aviso enviado al webhook")
        except Exception as e:
            log.warning("No se pudo avisar por webhook: %s", e)

    if not (s.smtp_host and s.smtp_to) and not s.notify_webhook:
        log.warning("Hay un aviso pero no hay forma de mandarlo: %s — %s", asunto, cuerpo)
