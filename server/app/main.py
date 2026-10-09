"""
API que crea notas de Anki para la PWA. Pensado para un solo usuario detrás de Cloudflare Tunnel.

Endpoints:
  GET  /health            estado, sin autenticación (para el health check del túnel)
  GET  /decks             mazos de la colección
  POST /notetype/ensure   crea o actualiza el tipo de nota «JP Dict»
  POST /notes             crea una nota (resuelve el audio si hay pack)
  POST /audio             el audio de una palabra, para escucharlo antes de añadirla
  PUT  /copia             guarda una copia de seguridad de la PWA (historial, ajustes…)
  GET  /copia             devuelve la última copia guardada
  POST /sync              sincroniza con AnkiWeb
"""

from __future__ import annotations

import json
import logging
import mimetypes
import secrets
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .anki_service import FIELDS, NOTETYPE_FRASE, NOTETYPE_NAME, AnkiService, ServiceError
from . import copias
from .autosync import AutoSync
from .config import Settings, load_settings
from .textos import idioma_de, traducir
from .voicevox import calentar

settings: Settings = load_settings()
service = AnkiService(settings)
autosync = AutoSync(service, settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    service.open()
    autosync.start()
    if settings.voicevox_url:
        # VOICEVOX carga el modelo de cada voz en la primera síntesis (varios segundos); mejor ahora
        # que en el primer ▶ del día.
        threading.Thread(target=calentar, args=(settings.voicevox_url, settings.voicevox_speaker), daemon=True).start()
    try:
        yield
    finally:
        autosync.stop()
        service.close()


app = FastAPI(title="kotodex-anki", version="1.0.0", lifespan=lifespan)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language"],
        expose_headers=["Server-Timing"],
        max_age=86400,
    )


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
    # El idioma se decide aquí: es donde se tiene la cabecera de la petición.
    idioma = idioma_de(request.headers.get("accept-language"))
    return JSONResponse(
        status_code=exc.status,
        content={"detail": traducir(exc.clave, idioma, exc.params)},
    )


async def require_token(
    authorization: str = Header(default=""),
    accept_language: str = Header(default=""),
) -> None:
    """Token propio en la cabecera Authorization. Cloudflare Access va por delante, no en vez de."""
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(value, settings.token):
        raise HTTPException(
            status_code=401,
            detail=traducir("token_invalido", idioma_de(accept_language), {}),
        )


Auth = Depends(require_token)


# ---- esquemas ----------------------------------------------------------

class EnsureNotetypeRequest(BaseModel):
    force: bool = Field(default=False, description="Añadir campos que falten aunque obligue a un full sync.")


class NoteRequest(BaseModel):
    fields: dict[str, str]
    deck: str = ""
    tags: list[str] = Field(default_factory=list)
    allow_duplicate: bool = False
    create_deck: bool = True
    with_audio: bool = True


class WordRef(BaseModel):
    expression: str
    reading: str = ""


class CheckRequest(BaseModel):
    # Tope por petición: cada palabra es una búsqueda en la colección (~60 ms).
    words: list[WordRef] = Field(default_factory=list, max_length=50)


class AudioRequest(BaseModel):
    expression: str
    reading: str = ""
    # Para que VOICEVOX ponga el acento del gráfico, igual que al crear la nota.
    pitchnum: str = ""


class SyncRequest(BaseModel):
    wait_media: bool = True
    media_timeout: float = Field(default=120.0, ge=0, le=600)


# ---- endpoints ---------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "notetype": NOTETYPE_NAME,
        "fields": list(FIELDS),
        "sentence_notetype": NOTETYPE_FRASE,
        "audio": settings.has_audio,
        "sync": settings.can_sync,
        "autosync": {
            "cada_horas": settings.sync_every_hours,
            "proximo_en_minutos": (
                round(autosync.proximo_en_segundos / 60) if autosync.proximo_en_segundos is not None else None
            ),
            "ultimo_resultado": autosync.ultimo_resultado,
        },
    }


@app.get("/decks", dependencies=[Auth])
async def decks() -> dict:
    return {"decks": await run_in_threadpool(service.decks), "default": settings.default_deck}


@app.post("/notetype/ensure", dependencies=[Auth])
async def ensure_notetype(body: EnsureNotetypeRequest | None = None) -> dict:
    force = bool(body and body.force)
    return await run_in_threadpool(service.ensure_notetype, force=force)


@app.post("/notes", dependencies=[Auth])
async def add_note(body: NoteRequest) -> dict:
    nota = await run_in_threadpool(
        service.add_note,
        fields=body.fields,
        deck=body.deck,
        tags=body.tags,
        allow_duplicate=body.allow_duplicate,
        create_deck=body.create_deck,
        with_audio=body.with_audio,
    )
    # Que la tarjeta llegue al iPhone sin tener que ir a Ajustes a sincronizar a mano.
    autosync.nudge()
    return nota


@app.post("/notes/check", dependencies=[Auth])
async def check_notes(body: CheckRequest) -> dict:
    """Cuántas notas hay ya con cada palabra, en cualquier tipo de nota de la colección."""
    pares = [(w.expression, w.reading) for w in body.words]
    conteos = await run_in_threadpool(service.check_notes, pares)
    return {
        "results": [
            {"expression": w.expression, "reading": w.reading, **n}
            for w, n in zip(body.words, conteos)
        ]
    }


@app.post("/audio", dependencies=[Auth])
async def audio(body: AudioRequest) -> FileResponse:
    """
    POST y no GET con la palabra en la URL: la PWA lo pide con fetch (lleva el token en la cabecera),
    así que un <audio src> directo no serviría de todas formas.
    """
    path, fases = await run_in_threadpool(service.audio, body.expression, body.reading, body.pitchnum)
    tipo = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    # Server-Timing: la PWA lo enseña cuando el ▶ tarda, para saber qué fase es la lenta.
    tiempos = ", ".join(f"{nombre};dur={segundos * 1000:.0f}" for nombre, segundos in fases)
    # private: es audio para uso personal, que no lo guarde ninguna caché intermedia.
    return FileResponse(
        path, media_type=tipo, headers={"Cache-Control": "private, max-age=86400", "Server-Timing": tiempos}
    )


@app.put("/copia", dependencies=[Auth])
async def guardar_copia(request: Request) -> dict:
    cuerpo = await request.body()
    if len(cuerpo) > copias.MAX_BYTES:
        raise ServiceError("copia_grande", 413)
    try:
        copia = json.loads(cuerpo)
    except ValueError as e:
        raise ServiceError("copia_invalida", error=str(e)) from e
    if not isinstance(copia, dict) or copia.get("app") != "kotodex":
        raise ServiceError("copia_invalida", error="no es una copia de kotodex")
    return await run_in_threadpool(copias.guardar, settings.collection_path, copia)


@app.get("/copia", dependencies=[Auth])
async def ultima_copia() -> dict:
    copia = await run_in_threadpool(copias.ultima, settings.collection_path)
    if copia is None:
        raise ServiceError("sin_copias", 404)
    return copia


@app.post("/sync", dependencies=[Auth])
async def sync(body: SyncRequest | None = None) -> dict:
    body = body or SyncRequest()
    return await run_in_threadpool(
        service.sync, wait_media=body.wait_media, media_timeout=body.media_timeout
    )
