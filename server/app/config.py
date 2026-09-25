"""Configuración por variables de entorno. Solo KOTODEX_TOKEN es obligatoria."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent   # server/
REPO_DIR = SERVER_DIR.parent                          # raíz del repo, donde vive notetype/


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _paths(name: str) -> tuple[Path, ...]:
    """Lista de rutas separadas por ; en Windows y : en Linux."""
    raw = _env(name)
    return tuple(Path(p).expanduser() for p in raw.split(os.pathsep) if p.strip())


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    token: str
    collection_path: Path
    notetype_dir: Path
    default_deck: str
    audio_dirs: tuple[Path, ...]
    audio_patterns: tuple[str, ...]
    audio_urls: tuple[str, ...]
    audio_cache: Path
    audio_timeout: float
    voicevox_url: str
    voicevox_speaker: int
    ankiweb_username: str
    ankiweb_password: str
    ankiweb_endpoint: str | None
    cors_origins: tuple[str, ...]
    sync_every_hours: float
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from: str
    smtp_to: str
    notify_webhook: str
    dupes_exclude_decks: tuple[str, ...]

    @property
    def can_sync(self) -> bool:
        return bool(self.ankiweb_username and self.ankiweb_password)

    @property
    def has_audio(self) -> bool:
        return bool(self.audio_dirs or self.audio_urls or self.voicevox_url)


def load_settings() -> Settings:
    token = _env("KOTODEX_TOKEN")
    if not token:
        raise ConfigError(
            "Falta KOTODEX_TOKEN. Genera uno con `python -c \"import secrets; print(secrets.token_urlsafe(32))\"` "
            "y ponlo en el .env del servidor y en Ajustes de la PWA."
        )
    if len(token) < 16:
        raise ConfigError("KOTODEX_TOKEN es demasiado corto: usa al menos 16 caracteres.")

    patterns = _env("KOTODEX_AUDIO_PATTERNS")
    urls = _env("KOTODEX_AUDIO_URLS")
    return Settings(
        token=token,
        collection_path=Path(_env("KOTODEX_COLLECTION", str(SERVER_DIR / "data" / "collection.anki2"))).expanduser(),
        notetype_dir=Path(_env("KOTODEX_NOTETYPE_DIR", str(REPO_DIR / "notetype"))).expanduser(),
        default_deck=_env("KOTODEX_DEFAULT_DECK", "日本語"),
        audio_dirs=_paths("KOTODEX_AUDIO_DIRS"),
        audio_patterns=tuple(p.strip() for p in patterns.split("|") if p.strip()),
        audio_urls=tuple(u.strip() for u in urls.split("|") if u.strip()),
        audio_cache=Path(_env("KOTODEX_AUDIO_CACHE", str(SERVER_DIR / "data" / "audio-cache"))).expanduser(),
        audio_timeout=float(_env("KOTODEX_AUDIO_TIMEOUT", "10") or 10),
        voicevox_url=_env("KOTODEX_VOICEVOX_URL"),
        voicevox_speaker=int(_env("KOTODEX_VOICEVOX_SPEAKER", "1") or 1),
        ankiweb_username=_env("ANKIWEB_USERNAME"),
        ankiweb_password=_env("ANKIWEB_PASSWORD"),
        ankiweb_endpoint=_env("ANKIWEB_ENDPOINT") or None,
        cors_origins=tuple(o.strip() for o in _env("KOTODEX_CORS_ORIGINS").split(",") if o.strip()),
        sync_every_hours=float(_env("KOTODEX_SYNC_EVERY_HOURS", "12") or 0),
        smtp_host=_env("KOTODEX_SMTP_HOST"),
        smtp_port=int(_env("KOTODEX_SMTP_PORT", "587") or 587),
        smtp_user=_env("KOTODEX_SMTP_USER"),
        smtp_password=_env("KOTODEX_SMTP_PASSWORD"),
        smtp_from=_env("KOTODEX_SMTP_FROM"),
        smtp_to=_env("KOTODEX_SMTP_TO"),
        notify_webhook=_env("KOTODEX_NOTIFY_WEBHOOK"),
        dupes_exclude_decks=tuple(
            d.strip() for d in _env("KOTODEX_DUPES_EXCLUDE_DECKS").split(",") if d.strip()
        ),
    )
