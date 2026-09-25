"""
Acceso a la colección de Anki.

La librería `anki` no es concurrente y bloquea el fichero de la colección, así que:
  - se abre una sola colección al arrancar y se cierra al parar,
  - todas las operaciones van bajo un lock,
  - uvicorn tiene que correr con UN solo worker (ver README).

Los datos se escriben al WAL de SQLite en cuanto se hace la operación, así que un corte de luz
no pierde notas. Para un backup hay que copiar collection.anki2 *y* collection.anki2-wal.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

from anki.collection import Collection
from anki.errors import DBError
from anki.notes import NoteFieldsCheckResult
from anki.sync_pb2 import SyncAuth, SyncCollectionResponse

from .audio import DEFAULT_PATTERNS, find_audio
from .config import Settings

# Contrato del tipo de nota: el orden y los nombres están fijados en CLAUDE.md y en notetype/.
NOTETYPE_NAME = "JP Dict"
TEMPLATE_NAME = "辞書"
FIELDS: tuple[str, ...] = (
    "Expression", "Reading", "Audio", "Pitch", "PitchNum", "DefJA", "DefES", "DefEN",
)

_CHANGES = SyncCollectionResponse.ChangesRequired
_FULL = {_CHANGES.FULL_SYNC, _CHANGES.FULL_DOWNLOAD, _CHANGES.FULL_UPLOAD}


class ServiceError(RuntimeError):
    """Error con un mensaje pensado para que lo lea Adrian en la PWA."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class AnkiService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.RLock()
        self._col: Collection | None = None
        self._auth: SyncAuth | None = None

    # ---- ciclo de vida -------------------------------------------------

    def open(self) -> None:
        path = self.settings.collection_path
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._col = Collection(str(path))
        except DBError as e:
            raise ServiceError(
                f"No se pudo abrir la colección en {path}: {e}. "
                "Suele ser que hay otro proceso usándola (¿un segundo worker de uvicorn?).",
                status=500,
            ) from e

    def close(self) -> None:
        with self._lock:
            if self._col is not None:
                self._col.close()
                self._col = None

    @property
    def col(self) -> Collection:
        if self._col is None:
            raise ServiceError("La colección no está abierta.", status=503)
        return self._col

    # ---- mazos ---------------------------------------------------------

    def decks(self) -> list[str]:
        with self._lock:
            names = [d.name for d in self.col.decks.all_names_and_ids(skip_empty_default=True)]
        return sorted(names)

    # ---- tipo de nota --------------------------------------------------

    def _templates(self) -> tuple[str, str, str]:
        directory = self.settings.notetype_dir
        try:
            front = (directory / "front.html").read_text(encoding="utf-8")
            back = (directory / "back.html").read_text(encoding="utf-8")
            css = (directory / "style.css").read_text(encoding="utf-8")
        except OSError as e:
            raise ServiceError(
                f"No se pudieron leer las plantillas en {directory}: {e}. "
                "Copia la carpeta notetype/ del repo o apunta KOTODEX_NOTETYPE_DIR a ella.",
                status=500,
            ) from e
        return front, back, css

    def ensure_notetype(self, *, force: bool = False) -> dict:
        """
        Crea el tipo de nota si no existe y, si ya está, refresca plantillas y CSS.

        Añadir campos que falten es un cambio de esquema y obliga a un full sync con AnkiWeb,
        así que no se hace sin force=True.
        """
        front, back, css = self._templates()
        with self._lock:
            mm = self.col.models
            existing = mm.by_name(NOTETYPE_NAME)

            if existing is None:
                notetype = mm.new(NOTETYPE_NAME)
                for name in FIELDS:
                    mm.add_field(notetype, mm.new_field(name))
                template = mm.new_template(TEMPLATE_NAME)
                template["qfmt"] = front
                template["afmt"] = back
                mm.add_template(notetype, template)
                notetype["css"] = css
                mm.add_dict(notetype)
                return {"created": True, "updated_templates": True, "added_fields": [], "warnings": []}

            present = [f["name"] for f in existing["flds"]]
            missing = [name for name in FIELDS if name not in present]
            warnings: list[str] = []

            if missing and not force:
                raise ServiceError(
                    f"El tipo de nota «{NOTETYPE_NAME}» ya existe pero le faltan campos: "
                    f"{', '.join(missing)}. Añadirlos obliga a un full sync con AnkiWeb. "
                    "Repite con force=true si quieres hacerlo (sincroniza todo antes).",
                    status=409,
                )
            for name in missing:
                mm.add_field(existing, mm.new_field(name))
            if missing:
                warnings.append("Se han añadido campos: el próximo sync con AnkiWeb será completo.")

            # El orden solo importa para leer la tarjeta: las notas se rellenan por nombre.
            if [f["name"] for f in existing["flds"]][: len(FIELDS)] != list(FIELDS):
                warnings.append(
                    "El orden de los campos no coincide con el del contrato; funciona igual, "
                    "pero conviene arreglarlo a mano en Anki."
                )

            if existing["tmpls"]:
                existing["tmpls"][0]["qfmt"] = front
                existing["tmpls"][0]["afmt"] = back
            else:
                template = mm.new_template(TEMPLATE_NAME)
                template["qfmt"] = front
                template["afmt"] = back
                mm.add_template(existing, template)
            existing["css"] = css
            mm.update_dict(existing)

            return {
                "created": False,
                "updated_templates": True,
                "added_fields": missing,
                "warnings": warnings,
            }

    # ---- notas ---------------------------------------------------------

    def add_note(
        self,
        *,
        fields: dict[str, str],
        deck: str,
        tags: list[str],
        allow_duplicate: bool = False,
        create_deck: bool = True,
        with_audio: bool = True,
    ) -> dict:
        unknown = sorted(set(fields) - set(FIELDS))
        if unknown:
            raise ServiceError(f"Campos que no existen en «{NOTETYPE_NAME}»: {', '.join(unknown)}.")
        if not fields.get("Expression", "").strip():
            raise ServiceError("Expression está vacío.")

        deck = deck.strip() or self.settings.default_deck

        with self._lock:
            notetype = self.col.models.by_name(NOTETYPE_NAME)
            if notetype is None:
                raise ServiceError(
                    f"El tipo de nota «{NOTETYPE_NAME}» no existe todavía. Llama antes a "
                    "POST /notetype/ensure.",
                    status=409,
                )

            deck_id = self.col.decks.id_for_name(deck)
            if deck_id is None:
                if not create_deck:
                    raise ServiceError(f"El mazo «{deck}» no existe.", status=404)
                deck_id = self.col.decks.id(deck)

            values = dict(fields)
            audio_file = None
            if with_audio and not values.get("Audio"):
                audio_file = self._attach_audio(values)

            note = self.col.new_note(notetype)
            for name, value in values.items():
                note[name] = value
            note.tags = [t.strip() for t in tags if t.strip()]

            check = note.fields_check()
            if check == NoteFieldsCheckResult.EMPTY:
                raise ServiceError("La nota se queda vacía con esos campos.")
            duplicate = check == NoteFieldsCheckResult.DUPLICATE
            if duplicate and not allow_duplicate:
                raise ServiceError(
                    f"«{values['Expression']}» ya está en la colección. "
                    "Repite con allow_duplicate=true si quieres añadirla igualmente.",
                    status=409,
                )

            self.col.add_note(note, deck_id)
            return {
                "note_id": int(note.id),
                "deck": deck,
                "audio": audio_file,
                "duplicate": duplicate,
            }

    def _attach_audio(self, values: dict[str, str]) -> str | None:
        """Busca el audio en el pack local y lo copia a la media de la colección."""
        path = find_audio(
            self.settings.audio_dirs,
            self.settings.audio_patterns or DEFAULT_PATTERNS,
            values.get("Expression", ""),
            values.get("Reading", ""),
        )
        if path is None:
            return None
        filename = self.col.media.add_file(str(path))
        values["Audio"] = f"[sound:{filename}]"
        return filename

    # ---- sincronización ------------------------------------------------

    def _sync_auth(self) -> SyncAuth:
        if self._auth is not None:
            return self._auth
        s = self.settings
        if not s.can_sync:
            raise ServiceError(
                "Faltan ANKIWEB_USERNAME y ANKIWEB_PASSWORD en el entorno del servidor.",
                status=409,
            )
        try:
            self._auth = self.col.sync_login(s.ankiweb_username, s.ankiweb_password, s.ankiweb_endpoint)
        except Exception as e:
            raise ServiceError(f"AnkiWeb rechazó el login: {e}", status=502) from e
        return self._auth

    def sync(self, *, wait_media: bool = True, media_timeout: float = 120.0) -> dict:
        with self._lock:
            auth = self._sync_auth()
            try:
                out = self.col.sync_collection(auth, True)
            except Exception as e:
                self._auth = None  # que el próximo intento vuelva a hacer login
                raise ServiceError(f"Falló la sincronización con AnkiWeb: {e}", status=502) from e

            if out.new_endpoint:
                self._auth = SyncAuth(hkey=auth.hkey, endpoint=out.new_endpoint)

            required = _CHANGES.Name(out.required)
            if out.required in _FULL:
                # Un full sync pisa una de las dos colecciones entera: eso se decide a mano.
                raise ServiceError(
                    f"AnkiWeb pide una sincronización completa ({required}). No se hace desde aquí: "
                    "resuélvela en el ordenador o en AnkiMobile y vuelve a intentarlo.",
                    status=409,
                )

            media = self._wait_media(media_timeout) if wait_media else "en curso"
            return {
                "required": required,
                "server_message": out.server_message,
                "media": media,
            }

    def _wait_media(self, timeout: float) -> str:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = self.col.media_sync_status()
            if not status.active:
                return "completada"
            time.sleep(0.5)
        return "sigue en curso al agotarse la espera"
