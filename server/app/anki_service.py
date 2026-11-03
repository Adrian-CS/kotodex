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

import logging
import threading
import time
from pathlib import Path

from anki.collection import Collection
from anki.errors import DBError
from anki.notes import NoteFieldsCheckResult
from anki.sync_pb2 import SyncAuth, SyncCollectionResponse

from .audio import DEFAULT_PATTERNS, cached_audio, fetch_audio, find_audio, guardar_en_cache
from .commons import buscar_commons
from .config import Settings
from .voicevox import synthesize

log = logging.getLogger("kotodex.audio")

# Contrato del tipo de nota: el orden y los nombres están fijados en CLAUDE.md y en notetype/.
NOTETYPE_NAME = "JP Dict"
TEMPLATE_NAME = "辞書"
FIELDS: tuple[str, ...] = (
    "Expression", "Reading", "Audio", "Pitch", "PitchNum", "DefJA", "DefES", "DefEN",
)

# Segundo tipo de nota, igual pero con la frase de la que salió la palabra. Es un tipo aparte porque
# añadir un campo a "JP Dict" obligaría a un sync completo; crear un tipo nuevo no.
NOTETYPE_FRASE = NOTETYPE_NAME + " + frase"
FIELDS_FRASE: tuple[str, ...] = FIELDS + ("Sentence",)
# La frase va justo antes de las definiciones: primero el contexto, luego el significado.
_BLOQUE_FRASE = '{{#Sentence}}<div class="sentence">{{Sentence}}</div>{{/Sentence}}\n\n'
_ANCLA_DEFS = '<section class="defs">'

_CHANGES = SyncCollectionResponse.ChangesRequired
_FULL = {_CHANGES.FULL_SYNC, _CHANGES.FULL_DOWNLOAD, _CHANGES.FULL_UPLOAD}


def _primer_downstep(pitchnum: str) -> int | None:
    """PitchNum puede traer varias acentuaciones ("0,2"); para sintetizar se usa la primera."""
    for parte in pitchnum.split(","):
        parte = parte.strip()
        if parte.lstrip("-").isdigit():
            return int(parte)
    return None


def _log_fases(palabra: str, fases: list[tuple[str, float]], path: Path | None) -> None:
    """Una línea por audio resuelto: «audio 橋: 8.31 s (http 6.20 s, voicevox 2.11 s) → 橋 - はし.wav»."""
    total = sum(t for _, t in fases)
    detalle = ", ".join(f"{n} {t:.2f} s" for n, t in fases if t >= 0.01)
    nivel = logging.WARNING if total >= 3 else logging.INFO
    log.log(nivel, "audio %s: %.2f s (%s) → %s", palabra, total, detalle or "-", path.name if path else "nada")


def _escapar(texto: str) -> str:
    """Deja el texto listo para meterlo entre comillas en una búsqueda de Anki."""
    for caracter in ("\\", '"', "*", "_", ":"):
        texto = texto.replace(caracter, "\\" + caracter)
    return texto


class ServiceError(RuntimeError):
    """
    Error que acaba en la pantalla del usuario.

    Guarda una CLAVE y sus parámetros en vez del texto: la traducción se hace al responder, que es
    cuando se sabe el idioma que pide la petición (ver app/textos.py).
    """

    def __init__(self, clave: str, status: int = 400, **params: object):
        super().__init__(clave)
        self.clave = clave
        self.status = status
        self.params = params


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
            raise ServiceError("coleccion_no_abre", 500, ruta=str(path), error=str(e)) from e

    def close(self) -> None:
        with self._lock:
            if self._col is not None:
                self._col.close()
                self._col = None

    @property
    def col(self) -> Collection:
        if self._col is None:
            raise ServiceError("coleccion_cerrada", 503)
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
            raise ServiceError("plantillas_no_leen", 500, ruta=str(directory), error=str(e)) from e
        return front, back, css

    def _templates_frase(self) -> tuple[str, str, str]:
        """Las de "JP Dict" con el bloque de la frase metido en el reverso: una sola plantilla que mantener."""
        front, back, css = self._templates()
        if _ANCLA_DEFS in back:
            back = back.replace(_ANCLA_DEFS, _BLOQUE_FRASE + _ANCLA_DEFS, 1)
        else:
            back = back + "\n" + _BLOQUE_FRASE
        return front, back, css

    def ensure_notetype(self, *, force: bool = False) -> dict:
        """
        Crea los tipos de nota si no existen y, si ya están, refresca plantillas y CSS.

        Añadir campos que falten es un cambio de esquema y obliga a un full sync con AnkiWeb,
        así que no se hace sin force=True. Crear el tipo «+ frase» no rompe nada.
        """
        front, back, css = self._templates()
        with self._lock:
            resultado = self._ensure_one(NOTETYPE_NAME, FIELDS, front, back, css, force=force)
            resultado["sentence_notetype"] = self._ensure_one(
                NOTETYPE_FRASE, FIELDS_FRASE, *self._templates_frase(), force=force
            )
        return resultado

    def _ensure_one(
        self, nombre: str, campos: tuple[str, ...], front: str, back: str, css: str, *, force: bool
    ) -> dict:
        mm = self.col.models
        existing = mm.by_name(nombre)

        if existing is None:
            notetype = mm.new(nombre)
            for name in campos:
                mm.add_field(notetype, mm.new_field(name))
            template = mm.new_template(TEMPLATE_NAME)
            template["qfmt"] = front
            template["afmt"] = back
            mm.add_template(notetype, template)
            notetype["css"] = css
            mm.add_dict(notetype)
            return {"created": True, "updated_templates": True, "added_fields": [], "warnings": []}

        present = [f["name"] for f in existing["flds"]]
        missing = [name for name in campos if name not in present]
        warnings: list[str] = []

        if missing and not force:
            raise ServiceError("faltan_campos", 409, notetype=nombre, campos=", ".join(missing))
        for name in missing:
            mm.add_field(existing, mm.new_field(name))
        if missing:
            warnings.append("Se han añadido campos: el próximo sync con AnkiWeb será completo.")

        # El orden solo importa para leer la tarjeta: las notas se rellenan por nombre.
        if [f["name"] for f in existing["flds"]][: len(campos)] != list(campos):
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
        # Con frase, la nota va al tipo «+ frase»; sin ella (o vacía), al de siempre.
        con_frase = bool(fields.get("Sentence", "").strip())
        nombre = NOTETYPE_FRASE if con_frase else NOTETYPE_NAME
        fields = {k: v for k, v in fields.items() if k != "Sentence" or con_frase}
        unknown = sorted(set(fields) - set(FIELDS_FRASE if con_frase else FIELDS))
        if unknown:
            raise ServiceError("campos_desconocidos", notetype=nombre, campos=", ".join(unknown))
        if not fields.get("Expression", "").strip():
            raise ServiceError("expression_vacia")

        deck = deck.strip() or self.settings.default_deck
        values = dict(fields)

        # Buscar el audio puede salir a la red, así que va fuera del lock: si no, una fuente HTTP
        # lenta dejaría la colección bloqueada para el resto de peticiones.
        audio_path = None
        if with_audio and not values.get("Audio"):
            fases: list[tuple[str, float]] = []
            audio_path = self._resolve_audio(values, fases)
            _log_fases(values.get("Expression", ""), fases, audio_path)

        with self._lock:
            notetype = self.col.models.by_name(nombre)
            if notetype is None and con_frase and self.col.models.by_name(NOTETYPE_NAME) is not None:
                # Servidor actualizado sin volver a pulsar «Crear tipo de nota»: se crea aquí, que
                # un tipo nuevo no rompe el sync incremental.
                self._ensure_one(NOTETYPE_FRASE, FIELDS_FRASE, *self._templates_frase(), force=False)
                notetype = self.col.models.by_name(nombre)
            if notetype is None:
                raise ServiceError("sin_tipo_de_nota", 409, notetype=nombre)

            deck_id = self.col.decks.id_for_name(deck)
            if deck_id is None:
                if not create_deck:
                    raise ServiceError("mazo_no_existe", 404, mazo=deck)
                deck_id = self.col.decks.id(deck)

            audio_file = None
            if audio_path is not None:
                audio_file = self.col.media.add_file(str(audio_path))
                values["Audio"] = f"[sound:{audio_file}]"

            note = self.col.new_note(notetype)
            for name, value in values.items():
                note[name] = value
            note.tags = [t.strip() for t in tags if t.strip()]

            check = note.fields_check()
            if check == NoteFieldsCheckResult.EMPTY:
                raise ServiceError("nota_vacia")
            duplicate = check == NoteFieldsCheckResult.DUPLICATE
            if duplicate and not allow_duplicate:
                raise ServiceError("duplicada", 409, palabra=values["Expression"])

            self.col.add_note(note, deck_id)
            return {
                "note_id": int(note.id),
                "deck": deck,
                "audio": audio_file,
                "duplicate": duplicate,
            }

    def audio(self, expression: str, reading: str, pitchnum: str = "") -> tuple[Path, list[tuple[str, float]]]:
        """
        El audio que llevaría la nota de esa palabra, para escucharlo antes de añadirla. Es la misma
        resolución (y la misma caché) que usa add_note, así que lo que suena es lo que irá a la tarjeta.
        No toca la colección: se puede llamar mientras otra petición escribe.
        """
        if not self.settings.has_audio:
            raise ServiceError("sin_fuentes_audio", 404)
        if not expression.strip():
            raise ServiceError("expression_vacia")
        fases: list[tuple[str, float]] = []
        path = self._resolve_audio(
            {"Expression": expression.strip(), "Reading": reading.strip(), "PitchNum": pitchnum}, fases
        )
        _log_fases(expression.strip(), fases, path)
        if path is None:
            raise ServiceError("sin_audio", 404, palabra=expression.strip())
        return path, fases

    def _resolve_audio(self, values: dict[str, str], fases: list[tuple[str, float]] | None = None) -> Path | None:
        """
        Por orden: pack local (instantáneo), caché, fuentes HTTP, grabaciones de Lingua Libre
        (Wikimedia Commons) y, como último recurso, síntesis con VOICEVOX. Voz humana antes que sintética siempre que se pueda.
        """
        s = self.settings
        expression = values.get("Expression", "")
        reading = values.get("Reading", "")
        fases = fases if fases is not None else []

        def medir(nombre: str, funcion):
            # Cada fase con su tiempo: es lo que llega a la PWA en Server-Timing cuando el ▶ va lento.
            inicio = time.monotonic()
            resultado = funcion()
            fases.append((nombre, time.monotonic() - inicio))
            return resultado

        # Pack y caché antes que nada que salga a la red: si la palabra ya se descargó o se
        # sintetizó una vez, no se vuelve a preguntar a Forvo (que es lo lento) ni a VOICEVOX.
        encontrado = (
            medir("pack", lambda: find_audio(s.audio_dirs, s.audio_patterns or DEFAULT_PATTERNS, expression, reading))
            or medir("cache", lambda: cached_audio(s.audio_cache, expression, reading))
            or medir("http", lambda: fetch_audio(s.audio_urls, s.audio_cache, expression, reading, s.audio_timeout))
            # Voz humana de Lingua Libre antes que la sintética.
            or (s.audio_commons and medir("commons", lambda: buscar_commons(expression, reading, s.audio_cache, s.audio_timeout)))
            or None
        )
        if encontrado or not s.voicevox_url:
            return encontrado

        # Se sintetiza la LECTURA en kana: así no hay riesgo de que lea mal un kanji. El acento se
        # le impone desde PitchNum, que viene de Kanjium, para que el audio no contradiga al gráfico.
        wav = medir("voicevox", lambda: synthesize(
            s.voicevox_url,
            s.voicevox_speaker,
            reading or expression,
            _primer_downstep(values.get("PitchNum", "")),
            s.audio_timeout,
        ))
        if wav is None:
            return None
        return guardar_en_cache(s.audio_cache, expression, reading, wav, ".wav")

    # ---- duplicados ----------------------------------------------------

    def check_notes(self, pares: list[tuple[str, str]]) -> list[dict]:
        """
        Cuántas notas de la colección tienen ya esa palabra, mirando TODOS los tipos de nota.

        Se usa la búsqueda `*:palabra` (algún campo es exactamente eso) y no `palabra` a secas:
        buscando el texto suelto, 食べる aparece en 74 notas de una colección con frases minadas,
        y eso no es un duplicado. Con `*:` son 2, que es lo que interesa saber.

        Además se cuenta cuántas de esas notas ya están en estudio (`-is:new`): tener la palabra
        en una tarjeta nueva que nunca has visto no es lo mismo que tenerla aprendida.

        KOTODEX_DUPES_EXCLUDE_DECKS deja fuera los mazos que no cuentan (otro idioma, material
        viejo, lo que sea).
        """
        excluir = "".join(f' -deck:"{_escapar(m)}"' for m in self.settings.dupes_exclude_decks)
        with self._lock:
            salida: list[dict] = []
            for expression, reading in pares:
                # dict.fromkeys quita repetidos manteniendo el orden (palabra en kana = lectura).
                terminos = [t for t in dict.fromkeys([expression.strip(), reading.strip()]) if t]
                if not terminos:
                    salida.append({"notes": 0, "studied": 0})
                    continue
                consulta = "(" + " OR ".join(f'"*:{_escapar(t)}"' for t in terminos) + ")" + excluir
                try:
                    total = len(self.col.find_notes(consulta))
                    estudiadas = len(self.col.find_notes(consulta + " -is:new")) if total else 0
                    salida.append({"notes": total, "studied": estudiadas})
                except Exception:
                    # Una palabra rara no puede tumbar la comprobación de las demás.
                    salida.append({"notes": 0, "studied": 0})
            return salida

    # ---- sincronización ------------------------------------------------

    def _sync_auth(self) -> SyncAuth:
        if self._auth is not None:
            return self._auth
        s = self.settings
        if not s.can_sync:
            raise ServiceError("sin_credenciales", 409)
        try:
            self._auth = self.col.sync_login(s.ankiweb_username, s.ankiweb_password, s.ankiweb_endpoint)
        except Exception as e:
            raise ServiceError("login_rechazado", 502, error=str(e)) from e
        return self._auth

    def sync(self, *, wait_media: bool = True, media_timeout: float = 120.0) -> dict:
        with self._lock:
            auth = self._sync_auth()
            try:
                out = self.col.sync_collection(auth, True)
            except Exception as e:
                self._auth = None  # que el próximo intento vuelva a hacer login
                raise ServiceError("sync_fallido", 502, error=str(e)) from e

            if out.new_endpoint:
                self._auth = SyncAuth(hkey=auth.hkey, endpoint=out.new_endpoint)

            required = _CHANGES.Name(out.required)
            if out.required in _FULL:
                # Un full sync pisa una de las dos colecciones entera: eso se decide a mano (ver
                # descargar_conservando). El registro dice de qué lado vino el cambio de esquema.
                local = self.col.schema_changed()
                log.warning(
                    "AnkiWeb pide sincronización completa (%s). Cambio de esquema %s.", required,
                    "EN ESTE SERVIDOR (scm > ls)" if local else "en AnkiWeb u otro dispositivo, no aquí",
                )
                raise ServiceError("sync_completo", 409, estado=required)

            media = self._wait_media(media_timeout) if wait_media else "en curso"
            return {
                "required": required,
                "server_message": out.server_message,
                "media": media,
            }

    # ---- sincronización completa ---------------------------------------

    def descargar_conservando(self) -> dict:
        """
        Resuelve un «hace falta sincronización completa» descargando de AnkiWeb, sin perder lo que el
        servidor aún no había subido.

        El escritorio y AnkiMobile tienen la colección buena (el servidor solo añade tarjetas), así
        que la dirección correcta es siempre DESCARGAR. Pero una descarga a secas borraría las notas
        creadas aquí desde el último sync que funcionó: se guardan antes (usn = -1 = sin subir), se
        hace una copia de seguridad de la colección, se descarga y se vuelven a añadir. Luego un sync
        normal las sube.
        """
        with self._lock:
            auth = self._sync_auth()
            try:
                out = self.col.sync_collection(auth, False)
            except Exception as e:
                self._auth = None
                raise ServiceError("sync_fallido", 502, error=str(e)) from e
            if out.new_endpoint:
                auth = self._auth = SyncAuth(hkey=auth.hkey, endpoint=out.new_endpoint)
            if out.required not in _FULL:
                raise ServiceError("no_hace_falta_completo", 409)

            pendientes = self._notas_sin_subir()
            copias = self.settings.collection_path.parent / "backups"
            copias.mkdir(parents=True, exist_ok=True)
            self.col.create_backup(backup_folder=str(copias), force=True, wait_for_completion=True)
            log.warning("Descarga completa desde AnkiWeb: %d notas sin subir guardadas; copia en %s.",
                        len(pendientes), copias)

            self._descarga_completa(auth, out.server_media_usn)
            recuperadas, ya_estaban = self._volver_a_anadir(pendientes)
            log.warning("Descarga completa hecha: %d notas recuperadas, %d ya estaban.", recuperadas, ya_estaban)

        # Fuera del lock (sync() lo coge): sube las recuperadas.
        subida = self.sync(wait_media=False) if recuperadas else None
        return {
            "recuperadas": recuperadas,
            "ya_estaban": ya_estaban,
            "copia": str(copias),
            "required": subida["required"] if subida else "NO_CHANGES",
        }

    def _notas_sin_subir(self) -> list[dict]:
        """Las notas que este servidor tiene y AnkiWeb no: creadas (o tocadas) desde el último sync."""
        pendientes = []
        for nid in self.col.db.list("select id from notes where usn = -1"):
            nota = self.col.get_note(nid)
            tarjetas = nota.cards()
            pendientes.append({
                "tipo": nota.note_type()["name"],
                "campos": dict(nota.items()),
                "etiquetas": list(nota.tags),
                "mazo": self.col.decks.name(tarjetas[0].did) if tarjetas else self.settings.default_deck,
            })
        return pendientes

    def _descarga_completa(self, auth: SyncAuth, server_usn: int | None) -> None:
        # Como en Anki de escritorio: el backend cierra y reabre la colección por su cuenta.
        self.col.close_for_full_sync()
        try:
            try:
                self.col.full_upload_or_download(auth=auth, server_usn=None, upload=False)
            except Exception:
                # Algunas cuentas solo la aceptan con el media usn del servidor (ver first-sync.py).
                self.col.full_upload_or_download(auth=auth, server_usn=server_usn, upload=False)
        except Exception as e:
            raise ServiceError("descarga_fallida", 502, error=str(e)) from e
        finally:
            self.col.reopen(after_full_sync=True)

    def _volver_a_anadir(self, pendientes: list[dict]) -> tuple[int, int]:
        # Dos pasadas: primero se mira qué ya trae AnkiWeb, y luego se añade. Así una nota duplicada
        # a propósito aquí («Añadir igualmente») no se descarta por chocar con su propia copia.
        preparadas = []
        ya_estaban = 0
        for p in pendientes:
            tipo = self.col.models.by_name(p["tipo"])
            if tipo is None and p["tipo"] == NOTETYPE_FRASE:
                self._ensure_one(NOTETYPE_FRASE, FIELDS_FRASE, *self._templates_frase(), force=False)
                tipo = self.col.models.by_name(p["tipo"])
            if tipo is None:
                log.warning("No se recupera una nota de «%s»: ese tipo de nota ya no existe.", p["tipo"])
                continue
            nota = self.col.new_note(tipo)
            for nombre, valor in p["campos"].items():
                if nombre in nota:
                    nota[nombre] = valor
            nota.tags = p["etiquetas"]
            # Una nota que ya está en AnkiWeb (tocada aquí, no nueva) no se repite.
            if nota.fields_check() == NoteFieldsCheckResult.DUPLICATE:
                ya_estaban += 1
                continue
            preparadas.append((nota, p["mazo"]))
        for nota, mazo in preparadas:
            self.col.add_note(nota, self.col.decks.id(mazo))
        return len(preparadas), ya_estaban

    def _wait_media(self, timeout: float) -> str:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = self.col.media_sync_status()
            if not status.active:
                return "completada"
            time.sleep(0.5)
        return "sigue en curso al agotarse la espera"
