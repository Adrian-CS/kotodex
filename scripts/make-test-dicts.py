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
])
mk("jmdict_es.zip", "JMdict (Español)", [
    ["橋", "はし", "n", "", 100, ["puente"], 1, ""],
    ["今日", "きょう", "n", "", 100, ["hoy"], 4, ""],
])
mk("mono.zip", "国語 (test)", [
    ["橋", "はし", "", "", 0, [{"type": "structured-content", "content": [
        {"tag": "span", "data": {"content": "sense"}, "content": "川・谷・道路などの両側を結んで、その上を渡れるようにしたもの。"},
        {"tag": "div", "style": {"marginLeft": 1}, "content": ["「", {"tag": "ruby", "content": ["石", {"tag": "rt", "content": "いし"}]}, "の橋」"]},
        {"tag": "img", "path": "x.png"}]}], 1, ""],
    ["箸", "はし", "", "", 0, ["食べ物をはさむための二本の細い棒。"], 2, ""],
    ["今日", "きょう", "", "", 0, ["現在過ごしているこの日。本日。"], 3, ""],
])
mk("pitch.zip", "Kanjium pitch", None, [
    ["橋", "pitch", {"reading": "はし", "pitches": [{"position": 2}]}],
    ["箸", "pitch", {"reading": "はし", "pitches": [{"position": 1}]}],
    ["端", "pitch", {"reading": "はし", "pitches": [{"position": 0}]}],
    ["今日", "pitch", {"reading": "きょう", "pitches": [{"position": 1}, {"position": 0}]}],
    ["お母さん", "pitch", {"reading": "おかあさん", "pitches": [{"position": 2}]}],
])
print("OK →", out.resolve())
