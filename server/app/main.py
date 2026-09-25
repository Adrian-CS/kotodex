"""
API que crea notas de Anki para la PWA. Pensado para un solo usuario detrás de Cloudflare Tunnel.

Endpoints:
  GET  /health            estado, sin autenticación (para el health check del túnel)
  GET  /decks             mazos de la colección
  POST /notetype/ensure   crea o actualiza el tipo de nota «JP Dict»
  POST /notes             crea una nota (resuelve el audio si hay pack)
  POST /sync              sincroniza con AnkiWeb
"""

from __future__ import annotations

import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .anki_service import FIELDS, NOTETYPE_NAME, AnkiService, ServiceError
from .autosync import AutoSync
from .config import Settings, load_settings

settings: Settings = load_settings()
service = AnkiService(settings)
autosync = AutoSync(service, settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    service.open()
    autosync.start()
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
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=86400,
    )


@app.exception_handler(ServiceError)
async def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"detail": str(exc)})


async def require_token(authorization: str = Header(default="")) -> None:
    """Token propio en la cabecera Authorization. Cloudflare Access va por delante, no en vez de."""
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(value, settings.token):
        raise HTTPException(status_code=401, detail="Token inválido o ausente.")


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
    return await run_in_threadpool(
        service.add_note,
        fields=body.fields,
        deck=body.deck,
        tags=body.tags,
        allow_duplicate=body.allow_duplicate,
        create_deck=body.create_deck,
        with_audio=body.with_audio,
    )


@app.post("/notes/check", dependencies=[Auth])
async def check_notes(body: CheckRequest) -> dict:
    """Cuántas notas hay ya con cada palabra, en cualquier tipo de nota de la colección."""
    pares = [(w.expression, w.reading) for w in body.words]
    conteos = await run_in_threadpool(service.check_notes, pares)
    return {
        "results": [
            {"expression": w.expression, "reading": w.reading, "notes": n}
            for w, n in zip(body.words, conteos)
        ]
    }


@app.post("/sync", dependencies=[Auth])
async def sync(body: SyncRequest | None = None) -> dict:
    body = body or SyncRequest()
    return await run_in_threadpool(
        service.sync, wait_media=body.wait_media, media_timeout=body.media_timeout
    )
