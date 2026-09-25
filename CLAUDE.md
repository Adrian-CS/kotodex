# CLAUDE.md — 辞書 → Anki

Proyecto personal de Adrian (full-stack; TS/React/Next.js, Cloudflare). Uso **solo personal**: nunca se publica abierto.

## Objetivo
Diccionario japonés para iPhone (PWA en pantalla de inicio), estilo Yomitan: buscar una palabra → ver definición
en japonés + español/inglés + pitch accent → **un botón crea una tarjeta de Anki** en el mazo elegido.
Tarjeta: frente = solo la palabra; reverso = lectura, audio, gráfico de pitch, definiciones.

## Arquitectura (decidida)
```
PWA (este repo, Cloudflare Pages + Cloudflare Access)
  ├─ Diccionarios Yomitan importados por el usuario → IndexedDB (Dexie). Local-first.
  ├─ Genera los campos de la nota (incluido el SVG de pitch) en el cliente
  └─ Añadir a Anki:
       modo actual  → URL scheme de AnkiMobile (sin audio, sale de la app)
       modo futuro  → POST a servidor propio
Servidor (PENDIENTE, repo/carpeta aparte)
  FastAPI + librería Python `anki` en VM gratis (Oracle Cloud Always Free; alternativa: Pi en casa + Cloudflare Tunnel)
  ├─ Colección de Anki PERSISTENTE en disco (para sync incremental, no full sync)
  ├─ Crea la nota, adjunta el audio como media ([sound:x.mp3]), sincroniza con AnkiWeb
  └─ Audio desde un pack local tipo Yomitan (JPod101/NHK/Forvo) en disco o R2 privado
El usuario sincroniza AnkiMobile después. NO usar Workers para el servidor (necesita proceso Python + disco).
```

### Decisiones y por qué
- **Todo en formato Yomitan** (JMdict EN, JMdict ES, monolingüe, pitch Kanjium/NHK). Un solo importador; el usuario
  aporta sus diccionarios (los monolingües tienen copyright → no se incluyen ni se suben a ningún sitio).
- **El pitch se guarda como SVG estático dentro del campo** `Pitch` → la tarjeta funciona offline y sin JS en Anki.
- **Audio y API nunca públicos** (Cloudflare Access). No redistribuir audios.
- AnkiConnect no existe en iOS; por eso URL scheme ahora y servidor después.

## Stack
Vite 8 + React 19 + TypeScript **5** (fijado: TS 7 dio problemas con `tsc -b`), Dexie 4 + dexie-react-hooks,
fflate (unzip), vite-plugin-pwa. Sin framework CSS: `src/styles.css` con tokens en `:root`.

## Mapa del código
- `src/db.ts` — esquema Dexie v1: `dictionaries(++id,&title)`, `terms(++id,dict,expression,reading)`,
  `metas(++id,dict,expression)`, `added(&key)`. Roles: `ja|es|en|pitch|other` (other = ignorado).
- `src/importer.ts` — unzip (solo .json), term_bank / term_meta_bank en orden numérico, `bulkAdd` por archivo,
  adivina el rol por título, rollback si falla, pide `navigator.storage.persist()`.
- `src/structured.ts` — structured-content → HTML con **lista blanca** de etiquetas/estilos; `<a>`→span; imágenes omitidas.
  Escapar SIEMPRE: este HTML acaba en la tarjeta y en `dangerouslySetInnerHTML`.
- `src/search.ts` — exacta por expresión/lectura (variantes hira/kata) → si no hay, prefijo (limit 200).
  Agrupa por (expresión, lectura), ordena exacta-expr > exacta-lectura > prefijo, luego score. Máx 20. Pitch desde metas.
- `src/pitch.ts` — moras (kana pequeños se unen; っ ん ー cuentan), patrón H/L + partícula, SVG. Probado 平板/頭高/中高/尾高.
- `src/anki.ts` — `buildFields(entry)` y `ankiMobileUrl()`. Ojo: se reemplaza `+`→`%20` (un `+` real ya va como `%2B`).
- `src/settings.ts` — mazos, último mazo, tipo de nota, perfil, etiquetas (localStorage, PWA propia).
- `src/components/` — SearchView (siempre montado para no perder la búsqueda), EntryCard, DictionariesView, SettingsView.
- `notetype/` — plantillas del tipo de nota **JP Dict** (front.html, back.html, style.css; soporta `.nightMode`).
- `scripts/make-test-dicts.py` — diccionarios de prueba en `test-dicts/`.

## Contrato: tipo de nota "JP Dict" (no cambiar orden/nombres sin actualizar anki.ts, notetype/ y servidor)
1 Expression · 2 Reading · 3 Audio (`[sound:…]`, lo pone el servidor) · 4 Pitch (HTML/SVG) · 5 PitchNum (`0` o `0,2`)
· 6 DefJA · 7 DefES · 8 DefEN. Las defs van envueltas en `<div class="dict" data-dict="Título">`.

## Formatos Yomitan (v3)
- term_bank: `[expression, reading("" = igual), defTags, rules, score, glossary[], sequence, termTags]`
- glossary item: string | `{type:"text"}` | `{type:"structured-content", content}` | `{type:"image"}`
- term_meta_bank: `[expression, "pitch", {reading, pitches:[{position:number, …}]}]` (también `freq`, se ignora)

## Convenciones
- Textos de la UI en español, sentence case, verbos claros ("Añadir a Anki", "Importar .zip"). Errores dicen qué pasó y qué hacer.
- Comentarios del código en español.
- Diseño: tinta sobre papel, mincho para el término, color 藍 (#2f5d8a / dark #8fb4dc) SOLO para pitch y acciones.
  Respetar safe areas (viewport-fit=cover, env(safe-area-inset-*)) y modo oscuro.

## Probar
```bash
npm install && python3 scripts/make-test-dicts.py && npm run dev
```
Importar los 4 zips de `test-dicts/`, buscar はし (3 entradas, pitches [2],[1],[0]) y 今日 (dos pitches [1],[0], con ES).
`npx tsc -p .` debe salir limpio. Para verificar UI móvil: Playwright a 390×844.

## Gotchas
- iOS: usar desde pantalla de inicio o Safari puede purgar IndexedDB; el usuario guarda los .zip en Archivos.
- JMdict completo ≈ 200k términos: la importación va en el hilo principal → si se nota lenta, moverla a Web Worker.
- AnkiMobile necesita que el tipo de nota y el mazo existan con el nombre exacto.
- Longitud de URL: las defs largas inflan la URL del scheme; el servidor lo resuelve.

## Pendiente (por prioridad)
1. **Deinflector** (食べた→食べる): portar el de Yomitan (reglas + `rules` de term_bank para filtrar por clase).
2. **Servidor**: FastAPI + `anki`; endpoints `POST /notetype/ensure`, `POST /notes`, `GET /decks`, `POST /sync`.
   Auth vía Cloudflare Access (service token) o token propio. En la PWA: modo "servidor" en Ajustes + lista de mazos real.
3. Audio: resolver URL/archivo por (expresión, lectura) desde el pack local; preview de audio en la PWA.
4. Importación en Web Worker con progreso; imágenes de structured-content (guardar blobs).
5. Historial / lista de palabras añadidas.
