"""Recorrido completo: crear el tipo de nota, añadir notas, duplicados, audio y errores."""

from __future__ import annotations

from .conftest import TOKEN

WORD = {
    "Expression": "食べる",
    "Reading": "たべる",
    "Pitch": "<svg class=\"pitch\"></svg>",
    "PitchNum": "2",
    "DefJA": "食べ物を口に入れてかむ。",
    "DefES": "comer",
    "DefEN": "to eat",
}


def test_health_no_necesita_token(client):
    r = client.get("/health", headers={"Authorization": ""})
    assert r.status_code == 200
    assert r.json()["notetype"] == "JP Dict"
    assert r.json()["fields"][0] == "Expression"


def test_sin_token_da_401(client):
    assert client.get("/decks", headers={"Authorization": ""}).status_code == 401
    assert client.get("/decks", headers={"Authorization": "Bearer otro"}).status_code == 401


def test_cors_deja_pasar_a_la_pwa(client):
    r = client.options(
        "/notes",
        headers={
            "Origin": "https://kotodex.pages.dev",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "https://kotodex.pages.dev"


def test_cors_deja_subir_la_copia(client):
    # PUT /copia lleva preflight; sin PUT en allow_methods el navegador nunca manda la copia.
    r = client.options(
        "/copia",
        headers={
            "Origin": "https://kotodex.pages.dev",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200


def test_nota_sin_tipo_de_nota_avisa(client):
    r = client.post("/notes", json={"fields": WORD, "deck": "日本語"})
    assert r.status_code == 409
    assert "/notetype/ensure" in r.json()["detail"]


def test_ensure_notetype_crea_y_es_idempotente(client):
    r = client.post("/notetype/ensure", json={})
    assert r.status_code == 200, r.text
    creado = {"created": True, "updated_templates": True, "added_fields": [], "warnings": []}
    assert r.json() == {**creado, "sentence_notetype": creado}

    r = client.post("/notetype/ensure", json={})
    assert r.status_code == 200
    assert r.json()["created"] is False
    assert r.json()["added_fields"] == []


def test_añadir_nota_con_audio_y_mazo_nuevo(client):
    r = client.post("/notes", json={"fields": WORD, "deck": "日本語::辞書", "tags": ["jp-dict"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["note_id"] > 0
    assert body["deck"] == "日本語::辞書"
    assert body["duplicate"] is False
    # El pack de prueba tiene «食べる - たべる.mp3», así que debe engancharlo.
    assert body["audio"] == "食べる - たべる.mp3"

    assert "日本語::辞書" in client.get("/decks").json()["decks"]


def test_duplicado_se_rechaza_y_se_puede_forzar(client):
    r = client.post("/notes", json={"fields": WORD, "deck": "日本語::辞書"})
    assert r.status_code == 409
    assert "ya está en la colección" in r.json()["detail"]

    r = client.post("/notes", json={"fields": WORD, "deck": "日本語::辞書", "allow_duplicate": True})
    assert r.status_code == 200
    assert r.json()["duplicate"] is True


def test_campo_inventado_da_error(client):
    r = client.post("/notes", json={"fields": {**WORD, "Frecuencia": "1"}})
    assert r.status_code == 400
    assert "Frecuencia" in r.json()["detail"]


def test_expresion_vacia_da_error(client):
    r = client.post("/notes", json={"fields": {"Expression": "  ", "Reading": "x"}})
    assert r.status_code == 400


def test_palabra_sin_audio_se_añade_igual(client):
    r = client.post("/notes", json={"fields": {"Expression": "橋", "Reading": "はし"}})
    assert r.status_code == 200
    assert r.json()["audio"] is None


def test_mazo_inexistente_sin_crear(client):
    r = client.post(
        "/notes",
        json={"fields": {"Expression": "箸", "Reading": "はし"}, "deck": "No existe", "create_deck": False},
    )
    assert r.status_code == 404


def test_sync_sin_credenciales_avisa(client):
    r = client.post("/sync", json={})
    assert r.status_code == 409
    assert "ANKIWEB_USERNAME" in r.json()["detail"]


def test_token_correcto_es_el_del_entorno():
    assert len(TOKEN) >= 16


def test_check_detecta_lo_que_ya_esta(client):
    r = client.post("/notes/check", json={"words": [
        {"expression": "食べる", "reading": "たべる"},
        {"expression": "存在しない語", "reading": "そんざいしないご"},
    ]})
    assert r.status_code == 200
    resultados = r.json()["results"]
    assert resultados[0]["notes"] >= 1, "食べる se añadió antes en estos tests"
    assert resultados[0]["studied"] == 0, "las tarjetas recién creadas son nuevas"
    assert resultados[1]["notes"] == 0


def test_check_texto_raro_no_rompe(client):
    r = client.post("/notes/check", json={"words": [{"expression": 'a"*_:\\b', "reading": ""}]})
    assert r.status_code == 200
    assert r.json()["results"][0]["notes"] == 0


def test_check_sin_palabras(client):
    assert client.post("/notes/check", json={"words": []}).json()["results"] == []


def test_error_traducido_al_ingles(client):
    r = client.post("/notes", json={"fields": {"Expression": "  "}}, headers={"Accept-Language": "en"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Expression is empty."


def test_error_traducido_al_japones(client):
    r = client.post("/notes", json={"fields": {"Expression": "  "}}, headers={"Accept-Language": "ja-JP"})
    assert r.json()["detail"] == "Expression が空です。"


def test_idioma_desconocido_cae_al_castellano(client):
    r = client.post("/notes", json={"fields": {"Expression": "  "}}, headers={"Accept-Language": "de-DE"})
    assert r.json()["detail"] == "Expression está vacío."


def test_error_con_parametros_traducido(client):
    r = client.post(
        "/notes",
        json={"fields": {"Expression": "箸", "Reading": "はし"}, "deck": "No existe", "create_deck": False},
        headers={"Accept-Language": "en"},
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "The deck “No existe” does not exist."


def test_token_invalido_traducido(client):
    r = client.get("/decks", headers={"Authorization": "Bearer otro", "Accept-Language": "ja"})
    assert r.status_code == 401
    assert "トークン" in r.json()["detail"]


def test_audio_para_escuchar_antes_de_añadir(client):
    r = client.post("/audio", json={"expression": "食べる", "reading": "たべる"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"no es un mp3 de verdad"
    assert "private" in r.headers["cache-control"]


def test_audio_que_no_existe_da_404(client):
    r = client.post("/audio", json={"expression": "橋", "reading": "はし"}, headers={"Accept-Language": "es"})
    assert r.status_code == 404
    assert "橋" in r.json()["detail"]


def test_audio_necesita_token(client):
    r = client.post("/audio", json={"expression": "食べる"}, headers={"Authorization": ""})
    assert r.status_code == 401


def test_copia_se_guarda_y_se_recupera(client):
    copia = {"app": "kotodex", "version": 1, "historial": [{"key": "食べる\u0000たべる"}]}
    r = client.put("/copia", json=copia)
    assert r.status_code == 200, r.text
    assert r.json()["guardada"].startswith("kotodex-")
    assert client.get("/copia").json() == copia


def test_copia_que_no_es_de_kotodex_se_rechaza(client):
    r = client.put("/copia", json={"otra": "cosa"}, headers={"Accept-Language": "es"})
    assert r.status_code == 400
    assert "kotodex" in r.json()["detail"]


def test_copias_se_quedan_las_ultimas(tmp_path):
    from app import copias

    ruta = tmp_path / "collection.anki2"
    for i in range(copias.MAX_COPIAS + 5):
        (copias.directorio(ruta)).mkdir(parents=True, exist_ok=True)
        (copias.directorio(ruta) / f"kotodex-20260101-0000{i:02d}.json").write_text("{}", encoding="utf-8")
    copias.guardar(ruta, {"app": "kotodex", "n": "nueva"})
    assert len(list(copias.directorio(ruta).glob("kotodex-*.json"))) == copias.MAX_COPIAS
    assert copias.ultima(ruta) == {"app": "kotodex", "n": "nueva"}



def test_tipo_con_frase_lleva_el_campo_y_el_bloque(client):
    from app.main import service

    client.post("/notetype/ensure", json={})
    nt = service.col.models.by_name("JP Dict + frase")
    assert [f["name"] for f in nt["flds"]][-1] == "Sentence"
    assert "{{#Sentence}}" in nt["tmpls"][0]["afmt"]
    # El tipo de siempre no se toca: añadirle un campo obligaría a un sync completo.
    assert "Sentence" not in [f["name"] for f in service.col.models.by_name("JP Dict")["flds"]]


def test_la_frase_de_verdad_va_antes_de_las_definiciones():
    from pathlib import Path

    from app.anki_service import _ANCLA_DEFS

    back = (Path(__file__).resolve().parents[2] / "notetype" / "back.html").read_text(encoding="utf-8")
    assert _ANCLA_DEFS in back


def test_nota_con_frase_va_al_tipo_con_frase(client):
    from app.main import service

    frase = {**WORD, "Expression": "読む", "Reading": "よむ", "Sentence": "本を<b>読んだ</b>。"}
    r = client.post("/notes", json={"fields": frase, "deck": "日本語"})
    assert r.status_code == 200, r.text
    nota = service.col.get_note(r.json()["note_id"])
    assert nota.note_type()["name"] == "JP Dict + frase"
    assert nota["Sentence"] == "本を<b>読んだ</b>。"

    # Frase vacía: al tipo de siempre, sin campo de más.
    sin = {**WORD, "Expression": "書く", "Reading": "かく", "Sentence": "  "}
    r = client.post("/notes", json={"fields": sin, "deck": "日本語"})
    assert r.status_code == 200, r.text
    assert service.col.get_note(r.json()["note_id"]).note_type()["name"] == "JP Dict"


def test_sin_tipo_con_frase_se_crea_al_añadir(client):
    from app.main import service

    nt = service.col.models.by_name("JP Dict + frase")
    for nid in service.col.models.nids(nt):
        service.col.remove_notes([nid])
    service.col.models.remove(nt["id"])

    frase = {**WORD, "Expression": "話す", "Reading": "はなす", "Sentence": "<b>話して</b>ください"}
    r = client.post("/notes", json={"fields": frase, "deck": "日本語"})
    assert r.status_code == 200, r.text
    assert service.col.get_note(r.json()["note_id"]).note_type()["name"] == "JP Dict + frase"
