# CLAUDE.md — 辞書 → Anki

Proyecto personal de Adrian (full-stack; TS/React/Next.js, Cloudflare). Uso **solo personal**: nunca se publica abierto.
Licencia del código: **GPL-3.0-or-later** (`LICENSE`), porque los desconjugadores derivan de Yomitan (GPL). Esos
archivos conservan el aviso de copyright de Yomitan: no quitarlo. Licencias de los datos, en el README.

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
- `src/importer.ts` — unzip (solo .json), term_bank / term_meta_bank / kanji_bank en orden numérico, `bulkAdd` por
  archivo, adivina el rol por título, rollback si falla. Corre en un **Web Worker** (`importer.worker.ts`, con
  `unzipSync`: el unzip asíncrono de fflate abre sus propios workers y no todos los Safari los admiten anidados).
  La cola y el progreso son globales (`src/importaciones.ts`, `useImportacion()`): se ve desde la búsqueda y se
  puede seguir usando la app. Con JMdict real: mismo tiempo que en el hilo principal (~9 min en Chromium, manda
  IndexedDB), pero la peor congelación pasa de 3,35 s a 0,13 s. `navigator.storage.persist()` se pide al acabar,
  desde la ventana.
- `src/structured.ts` — structured-content → HTML con **lista blanca** de etiquetas/estilos; `<a>`→span; imágenes omitidas.
  Escapar SIEMPRE: este HTML acaba en la tarjeta y en `dangerouslySetInnerHTML`.
- `src/search.ts` — exacta por expresión/lectura (variantes hira/kata) → si no hay, **deinflexión** → si no, prefijo
  por expresión (limit 200). Agrupa por (expresión, lectura), ordena exacta-expr > exacta-lectura > prefijo, luego
  score. Máx 20. Pitch desde metas. Sin coincidencia exacta se busca también por PREFIJO de lectura (かいせ, kaise →
  解析), detrás de lo que dé el deinflector (かいせ es imperativo de 介す, pero casi siempre es 解析 a medias).
- Frecuencia: diccionarios con `term_meta_bank` de modo `freq` (JPDB, BCCWJ…), rol «freq». Ordena DESPUÉS de exacta y
  relevancia y ANTES del score de JMdict; usa solo el de más prioridad (cada uno mide en su escala) y respeta
  `frequencyMode` de index.json (puesto vs. apariciones). Se consulta para los 40 mejores candidatos, no para todos:
  es una consulta por expresión. También decide qué lista va primero en las búsquedas latinas (sake → 酒, no 辛口).
- `?q=` en la URL abre la app con esa búsqueda. En iOS no sirve para la app de la pantalla de inicio: los enlaces
  y Atajos abren Safari, que tiene su propio almacenamiento (sin los diccionarios importados).
- «Pegar y buscar» (icono de portapapeles DENTRO de la barra, a la derecha, solo con ella vacía; con texto ese hueco
  es de la ✕ del sistema): `navigator.clipboard.readText()` tras el toque; en iOS sale
  la burbuja «Pegar» del sistema y hay que tocarla (ninguna web lee el portapapeles sin confirmación). Se busca la
  primera línea con texto, hasta 40 caracteres. Sin permiso, aviso con la alternativa de pegar a mano.
- `src/frase.ts` — leer una frase (como Yomitan): con texto japonés de 5+ caracteres, SearchView enseña la frase
  tocable (un span por carácter, fija bajo la barra). Tocar busca la palabra que EMPIEZA ahí: `palabraEn()` prueba a la
  vez todos los cortes de hasta 10 caracteres y sus desconjugaciones (máx. 120 formas, una consulta `equals` por forma:
  kana por `reading`, lo demás por `expression`) y gana el corte más largo. Luego search() arma la ficha con ese trozo.
  NO se segmenta la frase al pegarla (en el iPhone serían segundos): solo se trabaja al tocar (1–9 ms en Chromium con
  JMdict real, ≤50 ms con la CPU ×6). Frase larga o con puntuación (`soloFrase`): no se busca entera hasta tocar.
  Coreano también: el trozo no pasa del espacio, y gana el corte más largo que exista tal cual (학교에 → 학교, las
  partículas caen solas) o con el deinflector coreano (갔어요 → 가다), que se carga al primer toque en hangul. La frase
  coreana corta solo en espacios (`word-break: keep-all` con `:lang(ko)`).
- Búsqueda por definición, tres cosas que costó afinar y conviene no deshacer:
  relevancia **por palabras** con el mismo tokenizador del índice (así «to eat» encuentra los
  sentidos escritos «eat», y los diccionarios que pegan la cabecera al sentido —«먹다 eat» en
  KRDICT— dejan de quedarse fuera); **reparto de huecos por diccionario** (`MIN_POR_DICCIONARIO`),
  porque si no JMdict se lleva los 20; y **deduplicado por definición**, porque los diccionarios
  coreanos meten las formas conjugadas como entradas sueltas (든, 듭, 드 comparten definición con
  들다) y llenaban la lista. Nada de penalizar por expresión corta: 물 es una palabra legítima.
- Filtros de diccionario encima de los resultados (`.filtros`): salen solos cuando hay más de uno y
  se reinician al cambiar la búsqueda. El filtro entra en `search()`, no se aplica encima: así el
  diccionario elegido aporta los 20 resultados y no solo los que sobrevivían al reparto. La lista de
  botones se calcula con la búsqueda sin filtrar y se conserva, o al filtrar desaparecerían.
- `components/SyncBanner.tsx` — banda de aviso si `/health` dice que el último sync automático falló.
  Es el aviso que se ve siempre: el correo y ntfy hay que configurarlos.
- Prioridad de diccionarios: `Dictionary.order` (flechas en Diccionarios). Decide el orden de los
  bloques de definición Y el de las secciones (国語/Español/English), en la app y en la tarjeta.
  SearchView depende de una «huella» de los diccionarios, no solo del número: sin eso, reordenar o
  desactivar uno no refresca lo que hay en pantalla.
- Búsqueda japonés → otro idioma: se indexa el japonés del glosario **solo si la cabecera no es
  japonesa**. Así entra un diccionario coreano→japonés y quedan fuera los monolingües, donde buscar
  人 devolvería miles de entradas que solo lo mencionan. Los resultados van con cuota reservada
  (`CUOTA_CRUZADA`) porque si no, las coincidencias exactas japonesas llenan la lista.
  Calidad honesta: depende de cómo escriba el glosario cada diccionario. Con Naver KR-JP, 人 y 本
  dan buenos resultados (사람/인간, 도서/서적) pero 水 no encuentra 물, porque su definición no trae
  水 como equivalente suelto sino dentro de una explicación.
- `src/deinflect-ko.ts` + `deinflect-ko-rules.ts` — deinflector coreano, portado de Yomitan
  (`korean-transforms.js`): 450 transformaciones, 2682 reglas. Las reglas trabajan sobre JAMO
  descompuestos (먹다 = ㅁㅓㄱㄷㅏ), así que usa `hangul-js` para descomponer y recomponer. Solo se
  aceptan candidatos que sean forma de diccionario (verbo, adjetivo, 이다); sin ese filtro 갔어요
  devuelve 갔 antes que 가다. Se carga con `import()` dinámico: 100 KB que no lastran el arranque.
- `src/romanizacion.ts` — búsqueda por romanización: «kaiseki» → かいせき → 懐石/会席/解析, «sarang» → 사랑.
  Genera CANDIDATOS (la romanización pierde información) y la búsqueda se queda con los que existen.
  Japonés: Hepburn/Kunrei/IME; la n va con la vocal siguiente (konnichiwa = こんにちわ), y cada o/u se
  prueba también larga (tokyo → とうきょう, katakana con ー). Coreano: romanización revisada probando
  todos los cortes de sílaba (meogeoyo → 먹어요) con licencias penalizadas (k por ㄱ en kimchi, ch por ㅈ,
  ㅂ/ㄱ nasalizadas); los de penalización 0 cuentan como exactos. Si no hay coincidencia, se pasa la
  forma literal por el deinflector (tabeta → 食べる). En `search()` va junto a la búsqueda por
  definición: si las dos dan algo se juntan, primero la de definiciones solo si un sentido ES la
  consulta («bridge»), y la segunda lista tiene huecos reservados (`CUOTA_SEGUNDA_LISTA`).
- Rendimiento en el iPhone (Safari va mucho más lento que Chromium con IndexedDB): las búsquedas
  obsoletas se cancelan entre fases (`OpcionesBusqueda.vigente`), lo latino espera 350 ms antes de
  buscar, los candidatos romanizados se buscan SOLO por `reading` (el importador la rellena siempre),
  sin diccionario coreano no se generan candidatos en hangul, y las fichas van memorizadas con una
  sola consulta de «ya añadida» para todas. Si una búsqueda pasa de 1,5 s, SearchView enseña el
  desglose por fases debajo de la barra: es la forma de medir en el propio teléfono.
- `src/deinflect.ts` — tabla de Yomitan (`ext/data/deinflect.json`, 36 razones / 569 reglas) en formato compacto
  `"sufijo:reemplazo:clasesEntrada:clasesSalida"`, con las razones en español. Filtra por el campo `rules` de
  term_bank; si el diccionario no lo trae (monolingües), acepta. `suruStem()` cubre 勉強しました → 勉強 (rules `vs`).
- `src/pitch.ts` — moras (kana pequeños se unen; っ ん ー cuentan), patrón H/L + partícula, SVG. Probado 平板/頭高/中高/尾高.
- `src/anki.ts` — `buildFields(entry)` y `ankiMobileUrl()`. Ojo: se reemplaza `+`→`%20` (un `+` real ya va como `%2B`).
- `src/kanji.ts` + `components/KanjiSheet.tsx` — ficha de kanji desde diccionarios `kanji_bank` (KANJIDIC de
  yomidevs/jmdict-yomitan; rol «kanji», tabla `kanji` de Dexie v5). Los kanji del término se tocan si hay algún
  diccionario de kanji activo. «Palabras» son las que EMPIEZAN por el kanji (rango del índice); «contiene» exigiría
  recorrer la tabla o indexar los kanji al importar. El JLPT de KANJIDIC es el antiguo (1–4); el actual (N5–N1) sale de `src/jlpt.ts`,
  las listas de Waller (no hay oficiales desde 2010), y el antiguo solo se enseña si el kanji no está en ellas.
- `src/trazos.ts` + `components/KanjiTrazos.tsx` — orden de trazos de KanjiVG (CC BY-SA): el SVG de cada kanji se
  pide a raw.githubusercontent.com (CORS abierto) al abrir su ficha y se guarda con la Cache API (`kanjivg-v1`), así
  que lo ya visto va sin conexión. Solo se extraen los `d` y la posición de los números; nunca se inserta el SVG
  descargado. Animación CSS con `pathLength=1`; cada trazo con opacidad 0 hasta su turno (si no, el extremo
  redondeado deja un punto).
- Radical y partes: del MISMO SVG de KanjiVG (`kvg:radical="general"`, `kvg:original` para variantes 忄→心; partes =
  grupos con `kvg:element` hijos directos del kanji). Número y nombre del radical en `src/radicales.ts`, generado con
  Python desde Unicode (NFKC de U+2F00–2FD5 + nombre oficial). Las partes se tocan y apilan fichas (`pilaKanji`
  en SearchView) con «← Volver».
- `src/busquedaRadicales.ts` + `components/RadicalPicker.tsx` — buscar kanji por radicales (botón 部 junto a la barra).
  Datos y lógica de `@johnmorrisdotca/bushu`: RADKFILE/KANJIDIC2 (EDRDG, CC BY-SA 4.0) y nombres de Kanji alive
  (CC BY 4.0), con la atribución al pie del selector. Se carga con `import()` (72 KB gzip). La cuadrícula tiene su
  propio scroll: si se desplazara toda la hoja, los kanji encontrados se perderían de vista. Tocar un kanji lo AÑADE
  a la consulta (se puede componer 懐石 en dos pasos).
- `src/reconocerKanji.ts` + `components/DibujoKanji.tsx` — buscar dibujando (botón ✎). Reconocedor de KanjiCanvas (MIT,
  copiado en `src/vendor/kanji-canvas.js` con su aviso; su licencia pide enlace al repo, que va al pie de la hoja).
  Solo se usan sus funciones de reconocimiento, con trazos propios. Patrones: 2.213 kanji (sin kana) en
  `public/kanjicanvas/patrones.json`, redondeados a enteros (1,5 MB, 510 KB gzip), descargados al abrir y guardados con la
  Cache API (`kanjicanvas-v1`). Pide el nº de trazos aproximadamente correcto (−2…+1). El reconocedor de Google NO se
  usa: es una API interna sin licencia para terceros. El lienzo nace con 300×150: comprobar ancho Y alto al dimensionarlo.
- `src/history.ts` + `components/HistoryView.tsx` — historial indexado por la palabra a la que se llega, no por
  lo tecleado: buscar 食べた y 食べる deja una entrada. Si la consulta nueva empieza por la anterior y han pasado
  menos de 2 min, sustituye a la anterior (escribir 食べる no deja 食, 食べ y 食べる).
- `src/settings.ts` — mazos, último mazo, tipo de nota, perfil, etiquetas, modo (`ankimobile`|`server`),
  URL y token del servidor (localStorage, PWA propia).
- `src/server.ts` — cliente del servidor: health, decks, notetype/ensure, notes, sync, audio. Los errores de la API se
  enseñan tal cual en la UI.
- Escuchar antes de añadir (▶ en cada ficha, solo en modo servidor): `POST /audio` devuelve el MISMO audio que irá a la
  tarjeta (pack → fuentes HTTP → VOICEVOX, con su caché). `src/reproductor.ts`: un solo <audio> que se desbloquea
  reproduciendo 10 ms de silencio DENTRO del toque; iOS no deja sonar un play() que llega tras un await. Se espera a
  que acabe el silencio antes de cambiar la fuente (cortarlo da AbortError y podría no desbloquear).
- `server/app/autosync.py` + `notify.py` — sync automático cada X horas en un hilo aparte; si falla, avisa por
  correo o webhook con instrucciones. No evita los 409 (los causa un cambio de esquema, no el volumen).
- `server/` — la API. Ver `server/README.md`: endpoints, despliegue y las trampas de la colección de Anki.
- `COMANDOS.md` — chuleta de operación (arrancar/reiniciar el servidor, Tailscale, desplegar, diagnóstico).
- `src/components/` — SearchView (siempre montado para no perder la búsqueda), EntryCard, DictionariesView, SettingsView.
- `notetype/` — plantillas del tipo de nota **JP Dict** (front.html, back.html, style.css; soporta `.nightMode`).
- `scripts/make-test-dicts.py` — diccionarios de prueba en `test-dicts/`.
- `scripts/test-deinflect.ts` — 33 casos del deinflector (`npm test`, usa `--experimental-strip-types`).
- `scripts/test-romanizacion.ts` — rōmaji y coreano romanizado (también en `npm test`).

## Contrato: tipo de nota "JP Dict" (no cambiar orden/nombres sin actualizar anki.ts, notetype/ y servidor)
1 Expression · 2 Reading · 3 Audio (`[sound:…]`, lo pone el servidor) · 4 Pitch (HTML/SVG) · 5 PitchNum (`0` o `0,2`)
· 6 DefJA · 7 DefES · 8 DefEN. Las defs van envueltas en `<div class="dict" data-dict="Título">`.

## Formatos Yomitan (v3)
- term_bank: `[expression, reading("" = igual), defTags, rules, score, glossary[], sequence, termTags]`
- glossary item: string | `{type:"text"}` | `{type:"structured-content", content}` | `{type:"image"}`
- term_meta_bank: `[expression, "pitch", {reading, pitches:[{position:number, …}]}]` y `freq` (número, `{value, displayValue}`
  o `{reading, frequency}`; ver `leerFrecuencia()` en search.ts)

## Idiomas de la interfaz
`src/i18n.ts` — español, inglés y japonés. El ajuste vive en `Settings.idioma` (`"auto"` = el del
sistema). Tres decisiones:
- Las razones del deinflector japonés se guardan en la tabla con la **clave original de Yomitan**
  (`past`, `-te`) y se traducen al enseñarlas. Las 450 coreanas NO se traducen: ya son terminología
  gramatical coreana y traducirlas las haría menos útiles.
- Los errores del servidor llegan traducidos: `ServiceError` lleva una CLAVE y sus parámetros
  (`server/app/textos.py`), y se traduce al responder con la cabecera `Accept-Language` que manda
  la PWA. Sin eso tendrías la interfaz en japonés y los errores en castellano.
- `main.tsx` comprueba si hay versión nueva cada hora y al volver a primer plano. Sin eso, una PWA
  en la pantalla de inicio de iOS puede pasar días sin enterarse de un despliegue.

## Convenciones
- Textos de la UI en español, sentence case, verbos claros ("Añadir a Anki", "Importar .zip"). Errores dicen qué pasó y qué hacer.
- Comentarios del código en español.
- Diseño: tinta sobre papel, mincho para el término, color 藍 (#2f5d8a / dark #8fb4dc) SOLO para pitch y acciones.
  Respetar safe areas (viewport-fit=cover, env(safe-area-inset-*)) y modo oscuro.

## Probar
```bash
npm install && python3 scripts/make-test-dicts.py && npm run dev
```
Importar los 6 zips de `test-dicts/`, buscar はし (3 entradas ordenadas por frecuencia: 橋, 端, 箸) y 今日 (dos pitches [1],[0], con ES).
Tocar 食 en 食べる abre su ficha (ショク・ジキ, た.べる, 9 trazos) con 食べる en «Palabras que empiezan por 食».
Conjugaciones: 食べた, 食べさせられた, たべている, 読まなかった, 高くない, 勉強しました → todas deben caer en su forma de
diccionario con la razón debajo del término. `npx tsc -p .` y `npm test` deben salir limpios.
Para verificar UI móvil: Playwright a 390×844.

Servidor: `cd server && ./venv/bin/python -m pytest tests -q` (51 casos, colección temporal). Para probarlo
junto a la PWA, levantar uvicorn con `KOTODEX_CORS_ORIGINS=http://localhost:5173` y poner esa URL en Ajustes.

## Gotchas
- iOS: usar desde pantalla de inicio o Safari puede purgar IndexedDB; el usuario guarda los .zip en Archivos.
- **No usar `anyOf` de Dexie** en tablas grandes: lo resuelve con un cursor que salta entre las claves y en
  Safari el salto avanza fila a fila. Con claves dispersas (かいせき + candidatos en hangul) tardaba 6,7 s en el
  iPhone y 10 ms en Chromium, así que en el ordenador no se ve. Usar `porClaves()` de search.ts: una consulta
  `equals` por clave, en paralelo.
- JMdict completo ≈ 530k términos (jmdict-yomitan actual). Si se cierra la app a mitad de importación, el
  diccionario queda a medias: borrarlo y reimportar.
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
- Coreano: el diccionario Naver KR-JP funciona sin cambios (el rol se detecta como "ja" porque sus
  definiciones son japonesas). No hay pitch ni hace falta. Los diccionarios coreanos no traen `rules`,
  así que no hay clase de palabra que filtrar.
- Los diccionarios importados antes del deinflector no guardaron `rules`: siguen funcionando, pero sin filtrar por
  clase de palabra (algún candidato de más). Reimportarlos lo arregla; no hay migración porque reescribir 200k filas
  en iOS no compensa.

## Pendiente (por prioridad)
1. **Terminar el despliegue**: `tailscale serve` en el portátil, app de Tailscale en el iPhone, y poner el origen
   de Pages en `KOTODEX_CORS_ORIGINS` (la PWA ya se despliega sola con cada push a main). Para el audio, decidir fuente: el addon Forvo local
   (exige Anki de escritorio abierto) o clave de la API de Forvo.
2. Imágenes de structured-content (guardar blobs).
3. Historial / lista de palabras añadidas.
