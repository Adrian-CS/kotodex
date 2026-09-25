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


def test_nota_sin_tipo_de_nota_avisa(client):
    r = client.post("/notes", json={"fields": WORD, "deck": "日本語"})
    assert r.status_code == 409
    assert "/notetype/ensure" in r.json()["detail"]


def test_ensure_notetype_crea_y_es_idempotente(client):
    r = client.post("/notetype/ensure", json={})
    assert r.status_code == 200, r.text
    assert r.json() == {"created": True, "updated_templates": True, "added_fields": [], "warnings": []}

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
