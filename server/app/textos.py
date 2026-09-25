"""
Mensajes de error en los tres idiomas de la PWA.

Los errores del servidor se enseñan tal cual en la interfaz, así que tienen que ir en el idioma que
tenga puesto el usuario. El servicio lanza `ServiceError` con una CLAVE y sus parámetros, y la
traducción se hace al responder, ya con la cabecera Accept-Language de la petición a mano.
"""

from __future__ import annotations

IDIOMAS = ("es", "en", "ja")
POR_DEFECTO = "es"

MENSAJES: dict[str, dict[str, str]] = {
    "coleccion_cerrada": {
        "es": "La colección no está abierta.",
        "en": "The collection is not open.",
        "ja": "コレクションが開いていません。",
    },
    "coleccion_no_abre": {
        "es": "No se pudo abrir la colección en {ruta}: {error}. "
              "Suele ser que hay otro proceso usándola (¿un segundo worker de uvicorn?).",
        "en": "Could not open the collection at {ruta}: {error}. "
              "Usually another process is using it (a second uvicorn worker?).",
        "ja": "{ruta} のコレクションを開けませんでした: {error}。"
              "別のプロセスが使用中のことが多いです（uvicorn のワーカーが 2 つ？）。",
    },
    "plantillas_no_leen": {
        "es": "No se pudieron leer las plantillas en {ruta}: {error}. "
              "Copia la carpeta notetype/ del repo o apunta KOTODEX_NOTETYPE_DIR a ella.",
        "en": "Could not read the templates at {ruta}: {error}. "
              "Copy the repo's notetype/ folder or point KOTODEX_NOTETYPE_DIR at it.",
        "ja": "{ruta} のテンプレートを読めませんでした: {error}。"
              "リポジトリの notetype/ をコピーするか、KOTODEX_NOTETYPE_DIR で指定してください。",
    },
    "faltan_campos": {
        "es": "El tipo de nota «{notetype}» ya existe pero le faltan campos: {campos}. "
              "Añadirlos obliga a un full sync con AnkiWeb. Repite con force=true si quieres "
              "hacerlo (sincroniza todo antes).",
        "en": "The note type “{notetype}” exists but is missing fields: {campos}. "
              "Adding them forces a full sync with AnkiWeb. Repeat with force=true if you want "
              "that (sync everything first).",
        "ja": "ノートタイプ「{notetype}」は存在しますが、フィールドが足りません: {campos}。"
              "追加すると AnkiWeb の完全同期が必要になります。承知のうえなら force=true で再実行してください"
              "（先にすべて同期しておくこと）。",
    },
    "campos_desconocidos": {
        "es": "Campos que no existen en «{notetype}»: {campos}.",
        "en": "Fields that do not exist in “{notetype}”: {campos}.",
        "ja": "「{notetype}」に存在しないフィールドです: {campos}。",
    },
    "expression_vacia": {
        "es": "Expression está vacío.",
        "en": "Expression is empty.",
        "ja": "Expression が空です。",
    },
    "sin_tipo_de_nota": {
        "es": "El tipo de nota «{notetype}» no existe todavía. Llama antes a POST /notetype/ensure.",
        "en": "The note type “{notetype}” does not exist yet. Call POST /notetype/ensure first.",
        "ja": "ノートタイプ「{notetype}」がまだありません。先に POST /notetype/ensure を呼んでください。",
    },
    "mazo_no_existe": {
        "es": "El mazo «{mazo}» no existe.",
        "en": "The deck “{mazo}” does not exist.",
        "ja": "デッキ「{mazo}」がありません。",
    },
    "nota_vacia": {
        "es": "La nota se queda vacía con esos campos.",
        "en": "The note would be empty with those fields.",
        "ja": "そのフィールドではノートが空になります。",
    },
    "duplicada": {
        "es": "«{palabra}» ya está en la colección. Repite con allow_duplicate=true si quieres "
              "añadirla igualmente.",
        "en": "“{palabra}” is already in the collection. Repeat with allow_duplicate=true if you "
              "want to add it anyway.",
        "ja": "「{palabra}」はすでにコレクションにあります。それでも追加するなら allow_duplicate=true "
              "で再実行してください。",
    },
    "sin_credenciales": {
        "es": "Faltan ANKIWEB_USERNAME y ANKIWEB_PASSWORD en el entorno del servidor.",
        "en": "ANKIWEB_USERNAME and ANKIWEB_PASSWORD are missing from the server environment.",
        "ja": "サーバーの環境変数に ANKIWEB_USERNAME と ANKIWEB_PASSWORD がありません。",
    },
    "login_rechazado": {
        "es": "AnkiWeb rechazó el login: {error}",
        "en": "AnkiWeb rejected the login: {error}",
        "ja": "AnkiWeb がログインを拒否しました: {error}",
    },
    "sync_fallido": {
        "es": "Falló la sincronización con AnkiWeb: {error}",
        "en": "Syncing with AnkiWeb failed: {error}",
        "ja": "AnkiWeb との同期に失敗しました: {error}",
    },
    "sync_completo": {
        "es": "AnkiWeb pide una sincronización completa ({estado}). No se hace desde aquí: "
              "resuélvela en el ordenador o en AnkiMobile y vuelve a intentarlo.",
        "en": "AnkiWeb is asking for a full sync ({estado}). That is not done from here: "
              "resolve it on your computer or in AnkiMobile and try again.",
        "ja": "AnkiWeb が完全同期を求めています（{estado}）。ここからは実行しません。"
              "パソコンか AnkiMobile で解決してから、もう一度お試しください。",
    },
    "token_invalido": {
        "es": "Token inválido o ausente.",
        "en": "Invalid or missing token.",
        "ja": "トークンが無効、または指定されていません。",
    },
}


def idioma_de(accept_language: str | None) -> str:
    """Primer idioma de la cabecera que tengamos traducido."""
    for parte in (accept_language or "").split(","):
        base = parte.split(";")[0].strip().lower().split("-")[0]
        if base in IDIOMAS:
            return base
    return POR_DEFECTO


def traducir(clave: str, idioma: str, params: dict[str, object]) -> str:
    """Mensaje ya formateado. Si falta la clave se devuelve tal cual, para no perder el error."""
    variantes = MENSAJES.get(clave)
    if not variantes:
        return clave
    plantilla = variantes.get(idioma) or variantes[POR_DEFECTO]
    try:
        return plantilla.format(**params)
    except (KeyError, IndexError):
        return plantilla
