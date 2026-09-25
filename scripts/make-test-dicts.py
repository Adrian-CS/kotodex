"""Genera diccionarios Yomitan mínimos en ./test-dicts para probar importación y búsqueda."""
import json, zipfile, pathlib
out = pathlib.Path("test-dicts"); out.mkdir(exist_ok=True)

def mk(name, title, terms=None, metas=None):
    with zipfile.ZipFile(out / name, "w") as z:
        z.writestr("index.json", json.dumps({"title": title, "revision": "test", "format": 3}, ensure_ascii=False))
        if terms: z.writestr("term_bank_1.json", json.dumps(terms, ensure_ascii=False))
        if metas: z.writestr("term_meta_bank_1.json", json.dumps(metas, ensure_ascii=False))

mk("jmdict_en.zip", "JMdict (English)", [
    ["橋", "はし", "n", "", 100, ["bridge"], 1, ""],
    ["箸", "はし", "n", "", 90, ["chopsticks"], 2, ""],
    ["端", "はし", "n", "", 80, ["end (e.g. of street)", "edge", "tip"], 3, ""],
    ["端", "はし", "n", "", 79, ["beginning", "start"], 3, ""],
    ["今日", "きょう", "n", "", 100, ["today", "this day"], 4, ""],
    ["お母さん", "おかあさん", "n", "", 100, ["mother", "mom"], 5, ""],
    # Con el campo "rules" (índice 3) puesto: es lo que usa el deinflector para filtrar.
    ["食べる", "たべる", "v1,vt", "v1", 100, ["to eat"], 6, ""],
    ["読む", "よむ", "v5,vt", "v5", 100, ["to read"], 7, ""],
    ["高い", "たかい", "adj-i", "adj-i", 100, ["tall", "expensive"], 8, ""],
    ["来る", "くる", "vk,vi", "vk", 100, ["to come"], 9, ""],
    ["勉強", "べんきょう", "n,vs", "vs", 100, ["study"], 10, ""],
])
mk("jmdict_es.zip", "JMdict (Español)", [
    ["橋", "はし", "n", "", 100, ["puente"], 1, ""],
    ["今日", "きょう", "n", "", 100, ["hoy"], 4, ""],
    ["食べる", "たべる", "v1,vt", "v1", 100, ["comer"], 6, ""],
    ["読む", "よむ", "v5,vt", "v5", 100, ["leer"], 7, ""],
    ["高い", "たかい", "adj-i", "adj-i", 100, ["alto", "caro"], 8, ""],
])
mk("mono.zip", "国語 (test)", [
    ["橋", "はし", "", "", 0, [{"type": "structured-content", "content": [
        {"tag": "span", "data": {"content": "sense"}, "content": "川・谷・道路などの両側を結んで、その上を渡れるようにしたもの。"},
        {"tag": "div", "style": {"marginLeft": 1}, "content": ["「", {"tag": "ruby", "content": ["石", {"tag": "rt", "content": "いし"}]}, "の橋」"]},
        {"tag": "img", "path": "x.png"}]}], 1, ""],
    ["箸", "はし", "", "", 0, ["食べ物をはさむための二本の細い棒。"], 2, ""],
    ["今日", "きょう", "", "", 0, ["現在過ごしているこの日。本日。"], 3, ""],
    # Un monolingüe normal no trae "rules": el deinflector lo acepta igualmente.
    ["食べる", "たべる", "", "", 0, ["食べ物を口に入れてかむ。"], 4, ""],
])
mk("pitch.zip", "Kanjium pitch", None, [
    ["橋", "pitch", {"reading": "はし", "pitches": [{"position": 2}]}],
    ["箸", "pitch", {"reading": "はし", "pitches": [{"position": 1}]}],
    ["端", "pitch", {"reading": "はし", "pitches": [{"position": 0}]}],
    ["今日", "pitch", {"reading": "きょう", "pitches": [{"position": 1}, {"position": 0}]}],
    ["お母さん", "pitch", {"reading": "おかあさん", "pitches": [{"position": 2}]}],
    ["食べる", "pitch", {"reading": "たべる", "pitches": [{"position": 2}]}],
    ["読む", "pitch", {"reading": "よむ", "pitches": [{"position": 1}]}],
    ["高い", "pitch", {"reading": "たかい", "pitches": [{"position": 2}]}],
])
print("OK →", out.resolve())
