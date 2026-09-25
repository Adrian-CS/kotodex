"""
Descarga completa inicial desde AnkiWeb. SE EJECUTA UNA SOLA VEZ, al montar el servidor.

Por qué existe: la colección del servidor nace vacía, y AnkiWeb tiene la tuya. La primera vez hay
que traérsela entera; a partir de ahí POST /sync ya hace sincronizaciones incrementales.
La API no hace esto a propósito, porque una sincronización completa pisa una de las dos
colecciones entera y eso no debería dispararlo un endpoint.

ANTES DE EJECUTARLO:
  - Para el servidor (Anki bloquea la colección en exclusiva).
  - Sincroniza tu Anki de escritorio, para que AnkiWeb tenga lo último.
  - Rellena ANKIWEB_USERNAME y ANKIWEB_PASSWORD en server\\.env

Uso, desde la carpeta server\\ :
    .\\venv\\Scripts\\python.exe deploy\\first-sync.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from anki.collection import Collection  # noqa: E402
from anki.sync_pb2 import SyncAuth, SyncCollectionResponse  # noqa: E402

CAMBIOS = SyncCollectionResponse.ChangesRequired


def cargar_env() -> None:
    """Lee server\\.env como UTF-8 (el mazo va en japonés)."""
    env = SERVER_DIR / ".env"
    if not env.exists():
        sys.exit(f"No existe {env}")
    for linea in env.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, _, valor = linea.partition("=")
        os.environ.setdefault(clave.strip(), valor.strip())


def main() -> None:
    cargar_env()

    usuario = os.environ.get("ANKIWEB_USERNAME", "").strip()
    clave = os.environ.get("ANKIWEB_PASSWORD", "").strip()
    if not usuario or not clave:
        sys.exit("Faltan ANKIWEB_USERNAME y ANKIWEB_PASSWORD en server\\.env")

    ruta = Path(os.environ.get("KOTODEX_COLLECTION") or SERVER_DIR / "data" / "collection.anki2")
    ruta.parent.mkdir(parents=True, exist_ok=True)

    print(f"Colección local: {ruta}")
    try:
        col = Collection(str(ruta))
    except Exception as e:
        sys.exit(f"No se pudo abrir la colección: {e}\n¿Está el servidor parado?")

    print(f"Notas que tiene ahora mismo: {col.note_count()}")
    print("\nEsto DESCARGA la colección de AnkiWeb y REEMPLAZA la local por completo.")
    print("Lo que haya en la colección local se pierde.")
    if input("Escribe DESCARGAR para continuar: ").strip() != "DESCARGAR":
        col.close()
        sys.exit("Cancelado.")

    print("\nEntrando en AnkiWeb…")
    auth = col.sync_login(usuario, clave, os.environ.get("ANKIWEB_ENDPOINT") or None)

    print("Comprobando qué hace falta…")
    salida = col.sync_collection(auth, False)
    requerido = CAMBIOS.Name(salida.required)
    print(f"  AnkiWeb dice: {requerido}")
    print(f"  endpoint: {auth.endpoint or '(por defecto)'} · host_number: {salida.host_number}")
    if salida.server_message:
        print(f"  Mensaje del servidor: {salida.server_message}")

    # AnkiWeb reparte las cuentas entre varios servidores. Si nos manda a otro y seguimos hablando
    # con el de entrada, la descarga falla (entre otras cosas con "missing original size").
    if salida.new_endpoint:
        print(f"  AnkiWeb nos manda a: {salida.new_endpoint}")
        auth = SyncAuth(hkey=auth.hkey, endpoint=salida.new_endpoint)

    if salida.required in (CAMBIOS.NO_CHANGES, CAMBIOS.NORMAL_SYNC):
        print("\nNo hace falta descarga completa: ya estáis sincronizados o basta con un sync normal.")
        print("Usa POST /sync desde la PWA. No se ha tocado nada.")
        col.close()
        return

    print("\nDescargando la colección… (los 65 MB tardan un poco)")
    try:
        col.full_upload_or_download(auth=auth, server_usn=None, upload=False)
    except Exception as e:
        print(f"  Falló sin server_usn ({e});\n  reintentando con el media usn del servidor…")
        col.full_upload_or_download(auth=auth, server_usn=salida.server_media_usn, upload=False)
    print(f"Hecho. Notas ahora: {col.note_count()}")
    print("Mazos:", ", ".join(d.name for d in col.decks.all_names_and_ids(skip_empty_default=True))[:300])

    print("\nAhora la media. Son casi 200.000 ficheros y 5,6 GB: esto va para largo.")
    print("Se puede cortar con Ctrl+C y retomarlo luego; continúa donde lo dejó.")
    col.sync_media(auth)
    try:
        while True:
            estado = col.media_sync_status()
            if not estado.active:
                break
            p = estado.progress
            print(f"  comprobados {p.checked} · añadidos {p.added} · borrados {p.removed}", end="\r")
            time.sleep(1)
        print("\nMedia sincronizada.")
    except KeyboardInterrupt:
        print("\nInterrumpido. La próxima sincronización sigue donde lo dejaste.")
        col.abort_media_sync()

    col.close()
    print("\nListo. Arranca el servidor y usa POST /sync de aquí en adelante.")


if __name__ == "__main__":
    main()
