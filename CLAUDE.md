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
       "ankimobile" → URL scheme de AnkiMobile (sin audio, sale de la app)
       "servidor"   → POST a servidor propio (con audio, sin salir de la app)
Servidor (server/, HECHO)
  FastAPI + librería Python `anki`, corriendo en el portátil de Adrian y expuesto con Tailscale Funnel.
  Mismo código en Linux (systemd) si algún día pasa a VM, VPS o mini PC.
  ├─ Colección de Anki PERSISTENTE en disco (para sync incremental, no full sync)
  ├─ Crea la nota, adjunta el audio como media ([sound:x.mp3]), sincroniza con AnkiWeb
  └─ Audio desde un pack local tipo Yomitan (JPod101/NHK/Forvo) en disco o R2 privado
El usuario sincroniza AnkiMobile después. NO usar Workers para el servidor (necesita proceso Python + disco).
Hosting descartado: Oracle Cloud (el antifraude rechaza el registro) y GCP e2-micro (la IPv4 son ~450円/mes,
el free tier no la cubre).
```

### Decisiones y por qué
- **Todo en formato Yomitan** (JMdict EN, JMdict ES, monolingüe, pitch Kanjium/NHK). Un solo importador; el usuario
  aporta sus diccionarios (los monolingües tienen copyright → no se incluyen ni se suben a ningún sitio).
- **El pitch se guarda como SVG estático dentro del campo** `Pitch` → la tarjeta funciona offline y sin JS en Anki.
- **Audio y API nunca públicos** (Cloudflare Access). No redistribuir audios.
- AnkiConnect no existe en iOS; por eso los dos modos: URL scheme y servidor propio. Aunque el servidor
  acabó corriendo en el portátil (donde sí hay AnkiConnect), se mantiene la colección propia para que
  funcione con Anki de escritorio cerrado. Coste: descarga completa inicial y tres dispositivos sincronizando.
- Cambios que **no** rompen el sync incremental (comprobado sobre `scm`): crear un tipo de nota, cambiar
  plantillas o CSS, crear mazos. **Sí** lo rompe añadir un campo a un tipo de nota existente.
- **Tailscale `serve` en vez de Cloudflare Tunnel** porque no hay dominio propio. Hace falta algo que dé nombre,
  certificado HTTPS y alcance detrás del router: la PWA va por HTTPS y el navegador bloquea las llamadas a
  `http://`, así que una IP pelada no vale. Cloudflare Tunnel exigiría comprar dominio.
  Se usa `serve` (solo dispositivos propios, el iPhone necesita la app de Tailscale activa) y no `funnel`
  (público) para no exponer el audio: copiar para uso personal está cubierto, publicarlo no.
- **El audio no se descarga de packs redistribuidos**: el servidor acepta fuentes HTTP configurables
  (`KOTODEX_AUDIO_URLS`) con caché en disco, que valen para el addon Forvo local, para la API oficial o para un
  pack propio. La caché se va convirtiendo en el pack.

## Stack
Vite 8 + React 19 + TypeScript **5** (fijado: TS 7 dio problemas con `tsc -b`), Dexie 4 + dexie-react-hooks,
fflate (unzip), vite-plugin-pwa. Sin framework CSS: `src/styles.css` con tokens en `:root`.

## Mapa del código
- `src/db.ts` — esquema Dexie v1: `dictionaries(++id,&title)`, `terms(++id,dict,expression,reading)`,
  `metas(++id,dict,expression)`, `added(&key)`; v3: `lookups(&key,at)` (historial).
  Roles: `ja|es|en|pitch|other` (other = ignorado). El pitch se lee de CUALQUIER diccionario activo que lo
  traiga, no solo de los de rol "pitch": hay diccionarios con términos y pitch a la vez y el rol es uno solo.
  `Term.rules` (clases de palabra) no está indexado y es opcional: falta en lo importado antes del deinflector.
- `src/importer.ts` — unzip (solo .json), term_bank / term_meta_bank en orden numérico, `bulkAdd` por archivo,
  adivina el rol por título, rollback si falla, pide `navigator.storage.persist()`.
- `src/structured.ts` — structured-content → HTML con **lista blanca** de etiquetas/estilos; `<a>`→span; imágenes omitidas.
  Escapar SIEMPRE: este HTML acaba en la tarjeta y en `dangerouslySetInnerHTML`.
- `src/search.ts` — exacta por expresión/lectura (variantes hira/kata) → si no hay, **deinflexión** → si no, prefijo
  por expresión (limit 200). Agrupa por (expresión, lectura), ordena exacta-expr > exacta-lectura > prefijo, luego
  score. Máx 20. Pitch desde metas. La búsqueda por prefijo aún no mira `reading`.
- `src/deinflect.ts` — tabla de Yomitan (`ext/data/deinflect.json`, 36 razones / 569 reglas) en formato compacto
  `"sufijo:reemplazo:clasesEntrada:clasesSalida"`, con las razones en español. Filtra por el campo `rules` de
  term_bank; si el diccionario no lo trae (monolingües), acepta. `suruStem()` cubre 勉強しました → 勉強 (rules `vs`).
- `src/pitch.ts` — moras (kana pequeños se unen; っ ん ー cuentan), patrón H/L + partícula, SVG. Probado 平板/頭高/中高/尾高.
- `src/anki.ts` — `buildFields(entry)` y `ankiMobileUrl()`. Ojo: se reemplaza `+`→`%20` (un `+` real ya va como `%2B`).
- `src/history.ts` + `components/HistoryView.tsx` — historial indexado por la palabra a la que se llega, no por
  lo tecleado: buscar 食べた y 食べる deja una entrada. Si la consulta nueva empieza por la anterior y han pasado
  menos de 2 min, sustituye a la anterior (escribir 食べる no deja 食, 食べ y 食べる).
- `src/settings.ts` — mazos, último mazo, tipo de nota, perfil, etiquetas, modo (`ankimobile`|`server`),
  URL y token del servidor (localStorage, PWA propia).
- `src/server.ts` — cliente del servidor: health, decks, notetype/ensure, notes, sync. Los errores de la API se
  enseñan tal cual en la UI.
- `server/app/autosync.py` + `notify.py` — sync automático cada X horas en un hilo aparte; si falla, avisa por
  correo o webhook con instrucciones. No evita los 409 (los causa un cambio de esquema, no el volumen).
- `server/` — la API. Ver `server/README.md`: endpoints, despliegue y las trampas de la colección de Anki.
- `COMANDOS.md` — chuleta de operación (arrancar/reiniciar el servidor, Tailscale, desplegar, diagnóstico).
- `src/components/` — SearchView (siempre montado para no perder la búsqueda), EntryCard, DictionariesView, SettingsView.
- `notetype/` — plantillas del tipo de nota **JP Dict** (front.html, back.html, style.css; soporta `.nightMode`).
- `scripts/make-test-dicts.py` — diccionarios de prueba en `test-dicts/`.
- `scripts/test-deinflect.ts` — 33 casos del deinflector (`npm test`, usa `--experimental-strip-types`).

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
Conjugaciones: 食べた, 食べさせられた, たべている, 読まなかった, 高くない, 勉強しました → todas deben caer en su forma de
diccionario con la razón debajo del término. `npx tsc -p .` y `npm test` deben salir limpios.
Para verificar UI móvil: Playwright a 390×844.

Servidor: `cd server && ./venv/bin/python -m pytest tests -q` (13 casos, colección temporal). Para probarlo
junto a la PWA, levantar uvicorn con `KOTODEX_CORS_ORIGINS=http://localhost:5173` y poner esa URL en Ajustes.

## Gotchas
- iOS: usar desde pantalla de inicio o Safari puede purgar IndexedDB; el usuario guarda los .zip en Archivos.
- JMdict completo ≈ 200k términos: la importación va en el hilo principal → si se nota lenta, moverla a Web Worker.
- AnkiMobile necesita que el tipo de nota y el mazo existan con el nombre exacto.
- Longitud de URL: las defs largas inflan la URL del scheme; el servidor lo resuelve.
- VOICEVOX: tocar `accent` en la consulta NO cambia el audio. `/synthesis` usa el `pitch` ya calculado
  de cada mora, así que hay que pasar por `/mora_data` para recalcularlo. Sin eso, 橋 y 箸 suenan igual.
- Borrar un diccionario quita primero su ficha y luego los términos por lotes. Con una transacción
  única, borrar JMdict (284k filas) bloquea IndexedDB y parece que la interfaz entera se ha colgado.
- `server/data/collection.media` tiene ~200.000 ficheros DENTRO del proyecto. Sin `optimizeDeps.entries` en
  vite.config.ts, `npm run dev` se cuelga en "scanning dependencies" porque Vite busca los puntos de entrada
  con un glob `**/*.html` por todo el árbol. No quitar esa opción ni el `server.watch.ignored`.
- El servidor va con UN worker: `anki` abre el SQLite en modo exclusivo. Por lo mismo, no se puede copiar la
  colección desde fuera mientras corre (el proceso se queda colgado); `server/deploy/backup.sh` para el servicio.
- No poner Cloudflare Access interactivo en el host de la API: tumba el preflight CORS y la PWA deja de funcionar.
  Autentica el bearer token.
- Los diccionarios importados antes del deinflector no guardaron `rules`: siguen funcionando, pero sin filtrar por
  clase de palabra (algún candidato de más). Reimportarlos lo arregla; no hay migración porque reescribir 200k filas
  en iOS no compensa.

## Pendiente (por prioridad)
1. **Terminar el despliegue**: `tailscale serve` en el portátil, app de Tailscale en el iPhone, desplegar la PWA
   en Pages y poner ese origen en `KOTODEX_CORS_ORIGINS`. Para el audio, decidir fuente: el addon Forvo local
   (exige Anki de escritorio abierto) o clave de la API de Forvo.
2. Preview del audio en la PWA (el servidor ya lo resuelve y lo adjunta).
3. Importación en Web Worker con progreso; imágenes de structured-content (guardar blobs).
4. Historial / lista de palabras añadidas.
5. Búsqueda por prefijo también sobre `reading` (escribir kana parcial no encuentra entradas con kanji).
