# 辞書 → Anki (PWA)

Diccionario japonés local-first que crea tarjetas del tipo de nota **JP Dict**.

## Desarrollo
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/
npm test           # casos del deinflector
```

## Desplegar en Cloudflare Pages
- Build command: `npm run build`
- Output directory: `dist`
- Protege el dominio con **Cloudflare Access** (gratis) para que solo entres tú.
- En el iPhone: abre la URL en Safari → Compartir → **Añadir a pantalla de inicio**
  (así iOS no borra IndexedDB por inactividad).

## Diccionarios (formato Yomitan .zip)
Se importan en la pestaña Diccionarios y se guardan en IndexedDB. El papel se adivina por el título y se puede cambiar:
- JMdict/Jitendex → inglés; si el título contiene "Español"/"spa" → español
- Solo `term_meta_bank` con pitch → Pitch accent
- El resto → definición en japonés

## Añadir a Anki

Dos modos, elegibles en Ajustes:

- **AnkiMobile**: abre la app con la nota rellenada. Sin audio, y sales de la PWA.
- **Servidor propio**: manda la nota a la API de [`server/`](server/), que adjunta el audio y sincroniza con
  AnkiWeb. No sales de la app. Hay que rellenar la dirección y el token en Ajustes y pulsar «Crear tipo de nota»
  una vez.

### AnkiMobile
Abre `anki://x-callback-url/addnote` con los campos rellenados. Requisitos:
1. El tipo de nota "JP Dict" existe en AnkiMobile (plantillas en el paquete del tipo de nota).
2. Los mazos de Ajustes coinciden exactamente con los de Anki.
El campo Audio va vacío hasta que esté el servidor.

## Estructura
- `src/db.ts` — esquema Dexie (dictionaries, terms, metas, added)
- `src/importer.ts` — lectura de zips Yomitan con fflate
- `src/structured.ts` — structured-content → HTML seguro (lista blanca de etiquetas y estilos)
- `src/search.ts` — búsqueda exacta (kanji/kana, hira↔kata), deinflexión y prefijo, agrupada por palabra
- `src/deinflect.ts` — deshace conjugaciones (tabla portada de Yomitan)
- `src/pitch.ts` — gráfico SVG de pitch
- `src/anki.ts` — campos de la nota + URL de AnkiMobile

## Conjugaciones
La búsqueda deshace la conjugación cuando no hay coincidencia exacta: 食べさせられた → 食べる, 高くない → 高い,
勉強しました → 勉強. Debajo del término aparece la forma escrita y qué se deshizo.

## Pendiente
- Desplegar el servidor y conseguir un pack de audio
- Imágenes de structured-content
- Búsqueda por prefijo sobre la lectura
