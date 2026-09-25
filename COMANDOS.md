# Comandos

Chuleta de todo lo que se usa para operar y cambiar el proyecto. Todo en **PowerShell**
(`PS C:\...>`), no en cmd: los `Get-*`, `Start-*` y `Select-String` son comandos suyos. Si el prompt
pone `C:\dev\kotodex>` a secas, escribe `powershell` y pulsa Enter.

---

## Al encender el portátil

Casi todo arranca solo. Esto es para comprobarlo o para levantarlo a mano si algo no subió.

```powershell
# 1. ¿Está el servidor?
curl.exe http://127.0.0.1:8000/health
# Si no responde:
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','C:\dev\kotodex\server\deploy\windows\start-kotodex.ps1'

# 2. ¿Está Tailscale sirviendo? (te recuerda la URL que va en Ajustes de la PWA)
tailscale serve status
# Si no sale nada:
tailscale serve --bg 8000

# 3. ¿Está VOICEVOX? (solo si quieres audio sintetizado)
curl.exe http://127.0.0.1:50021/version

# 4. Anki de escritorio: ábrelo si vas a usar el addon de audio.
```

En `/health` deberías ver `"audio":true`, `"sync":true` y el bloque `autosync`. En el iPhone,
acuérdate de tener la app de Tailscale activa.

## Cada vez que cambiamos el software

**Si el cambio toca `src/`** (buscador, interfaz, historial, diccionarios):

```powershell
cd C:\dev\kotodex
npm run build
npx wrangler pages deploy dist --project-name kotodex
```

Se despliega en `https://kotodex.pages.dev`, que es la URL fija. Wrangler imprime otra con un hash
delante: esa es la instantánea de ese despliegue concreto, no la uses.

En el iPhone la PWA se actualiza sola al abrirla. Si sigue con lo viejo, ciérrala del multitarea.

**Si el cambio toca el formato de los diccionarios** (índices nuevos, campos nuevos), además hay que
**borrar y reimportar los diccionarios** en el iPhone. Lo que ya está guardado no se reindexa solo.

**Si el cambio toca `server/`** (API, audio, sync, avisos):

```powershell
cd C:\dev\kotodex\server
.\deploy\windows
estart-kotodex.ps1
```

**Si cambia algo del audio** (voz, fuente), borra también la caché o seguirás oyendo lo anterior:

```powershell
Remove-Item C:\dev\kotodex\server\dataudio-cache -Recurse -Force
```

**Comprobar antes de desplegar**, siempre:

```powershell
cd C:\dev\kotodex
npx tsc -p . --noEmit
npm test
cd server; $env:PYTHONPATH="."; .env\Scripts\python.exe -m pytest tests -q
```

## Voces de VOICEVOX

El número de `KOTODEX_VOICEVOX_SPEAKER` es el del **estilo**, no el del personaje.

| Personaje | Estilos (nombre=número) |
| --- | --- |
| 四国めたん | ノーマル=2, あまあま=0, ツンツン=6, セクシー=4, ささやき=36, ヒソヒソ=37 |
| ずんだもん | ノーマル=3, あまあま=1, ツンツン=7, セクシー=5, ささやき=22 |
| 春日部つむぎ | ノーマル=8 |
| 雨晴はう | ノーマル=10 |
| 波音リツ | ノーマル=9, クイーン=65 |
| 玄野武宏 (masculina) | ノーマル=11, 喜び=39, ツンギレ=40, 悲しみ=41 |
| 白上虎太郎 | ふつう=12, わーい=32, びくびく=33, おこ=34 |
| 青山龍星 (masculina) | ノーマル=13, 熱血=81, 不機嫌=82, しっとり=84, 囁き=86 |
| 冥鳴ひまり | ノーマル=14 |
| 九州そら | ノーマル=16, あまあま=15, ツンツン=18, セクシー=17 |
| もち子さん | ノーマル=20, 泣き=77, 怒り=78, 喜び=79, のんびり=80 |
| 剣崎雌雄 (masculina) | ノーマル=21 |
| WhiteCUL | ノーマル=23, たのしい=24, かなしい=25 |
| **No.7** | **ノーマル=29, アナウンス=30**, 読み聞かせ=31 |
| ナースロボ＿タイプＴ | ノーマル=47, 楽々=48, 内緒話=50 |
| 猫使アル | ノーマル=55, おちつき=56, うきうき=57 |
| 満別花丸 | ノーマル=69, 元気=70, ささやき=71 |

Para vocabulario, **29 o 30** (No.7) son las más neutras. Voz masculina: **11** o **13**.
La lista completa (30 personajes, más de 100 estilos):

```powershell
curl.exe http://127.0.0.1:50021/speakers
```

Tras cambiar la voz: reinicia el servidor **y borra la caché de audio**.

## Servidor: día a día

```powershell
cd C:\dev\kotodex\server

# ¿Está vivo?
curl.exe http://127.0.0.1:8000/health

# Reiniciar (obligatorio cada vez que se toca el .env)
.\deploy\windows\restart-kotodex.ps1

# Arrancar si está parado
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','C:\dev\kotodex\server\deploy\windows\start-kotodex.ps1'

# Parar
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='uvicorn.exe'" |
    Where-Object { $_.CommandLine -like "*app.main*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Ver el registro
Get-Content .\data\kotodex.err.log -Tail 30
Get-Content .\data\kotodex.err.log -Wait      # en vivo, Ctrl+C para salir
```

`audio: false` en `/health` significa que `KOTODEX_AUDIO_URLS` está comentado o vacío.
`sync: false`, que faltan las credenciales de AnkiWeb.

### Arranque automático

```powershell
# Sin administrador (acceso directo en la carpeta de Inicio)
.\deploy\windows\install-startup.ps1
Remove-Item "$([Environment]::GetFolderPath('Startup'))\kotodex-anki.lnk"   # quitarlo

# Con administrador (tarea programada: reintenta si se cae)
.\deploy\windows\install-task.ps1
Start-ScheduledTask -TaskName kotodex-anki
Get-ScheduledTask -TaskName kotodex-anki | Select-Object TaskName, State
Unregister-ScheduledTask -TaskName kotodex-anki -Confirm:$false             # quitarla
```

Las dos arrancan **al iniciar sesión**, no al encender el portátil.

### Que no se duerma

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /query SCHEME_CURRENT SUB_SLEEP     # comprobar
```

El cierre de tapa se cambia por interfaz: Panel de control → Opciones de energía →
*comportamiento del cierre de la tapa* → No hacer nada (enchufado).

---

## Tailscale

```powershell
tailscale status                 # dispositivos conectados
tailscale serve status           # la URL https://…ts.net que va en Ajustes de la PWA
tailscale serve --bg 8000        # (re)publicar el puerto del servidor
tailscale serve reset            # borrar la configuración de serve y empezar de cero
tailscale up / tailscale down    # conectar / desconectar este equipo
```

Si `tailscale` no se reconoce tras instalarlo, es el PATH de la ventana:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
```

`serve` = solo tus dispositivos (el iPhone necesita la app activa).
`funnel` = accesible desde internet, protegido solo por el token.

---

## Configuración del servidor (`server\.env`)

Tras cualquier cambio: `.\deploy\windows\restart-kotodex.ps1`.

| Variable | Para qué |
| --- | --- |
| `KOTODEX_TOKEN` | El que va en Ajustes de la PWA. |
| `KOTODEX_CORS_ORIGINS` | Origen de la PWA (`https://…pages.dev`). Sin esto, el iPhone da error de conexión. |
| `KOTODEX_AUDIO_URLS` | Fuentes de audio. Con el addon de Anki abierto: `http://localhost:8770/?term={expression}&reading={reading}` |
| `KOTODEX_AUDIO_DIRS` | Pack de audio local, si algún día lo tienes. |
| `KOTODEX_DEFAULT_DECK` | Mazo por defecto. |
| `ANKIWEB_USERNAME` / `ANKIWEB_PASSWORD` | Para que `/sync` funcione. |
| `KOTODEX_SYNC_EVERY_HOURS` | Sync automático cada X horas. 0 lo desactiva. |
| `KOTODEX_SMTP_*` | Avisar por correo si el sync automático falla. |
| `KOTODEX_NOTIFY_WEBHOOK` | Avisar por ntfy u otro webhook de texto plano. |
| `KOTODEX_VOICEVOX_URL` / `_SPEAKER` | Síntesis de voz y qué estilo usar (ver tabla arriba). |
| `KOTODEX_DUPES_EXCLUDE_DECKS` | Mazos que no cuentan al avisar de duplicados. |

```powershell
# Ver el token sin abrir el fichero
Select-String -Path C:\dev\kotodex\server\.env -Pattern KOTODEX_TOKEN

# Generar uno nuevo (hay que cambiarlo también en Ajustes de la PWA)
.\venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

## PWA: desarrollo

```powershell
cd C:\dev\kotodex

npm install                  # solo la primera vez
npm run dev                  # http://localhost:5173
npm run build                # genera dist/
npm test                     # los 33 casos del deinflector
npx tsc -p . --noEmit        # comprobar tipos, tiene que salir limpio
```

Para probar la PWA contra el servidor en local, `KOTODEX_CORS_ORIGINS` tiene que incluir
`http://localhost:5173`, y en Ajustes pones `http://localhost:8000`.

Diccionarios de prueba (はし, 今日, 食べる, 読む, 高い…):

```powershell
python scripts\make-test-dicts.py     # los deja en test-dicts\
```

---

## PWA: desplegar

```powershell
cd C:\dev\kotodex
npm run build
npx wrangler login                                        # solo la primera vez
npx wrangler pages deploy dist --project-name kotodex
```

Después de desplegar por primera vez, mete la URL que te dé en `KOTODEX_CORS_ORIGINS` y reinicia el
servidor.

En el iPhone la PWA se actualiza sola al abrirla (el service worker está en `autoUpdate`). Si se
queda pegada a una versión vieja, ciérrala del multitarea y vuelve a abrirla.

---

## Servidor: desarrollo

```powershell
cd C:\dev\kotodex\server

$env:PYTHONPATH="."; .\venv\Scripts\python.exe -m pytest tests -q    # 18 tests
.\venv\Scripts\python.exe -m pip install -r requirements.txt         # reinstalar dependencias
```

Para desarrollar con recarga automática, sin el arranque en segundo plano:

```powershell
$env:PYTHONPATH="."
# -Encoding UTF8 es obligatorio: si no, el mazo 日本語 llega como 譌･譛ｬ隱・
Get-Content .env -Encoding UTF8 | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), "Process")
}
.\venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
```

Actualizar dependencias con cuidado: `anki` cambia de API entre versiones y el servidor usa
`sync_collection`, `add_note` y `models.*`. Si la subes, pasa los tests antes de nada.

---

## Anki

```powershell
# Tras cambiar notetype\front.html, back.html o style.css:
#   pulsar «Crear tipo de nota» en Ajustes de la PWA, o:
$t = (Select-String -Path .\server\.env -Pattern 'KOTODEX_TOKEN=(.+)').Matches.Groups[1].Value
curl.exe -X POST -H "Authorization: Bearer $t" http://127.0.0.1:8000/notetype/ensure

# Mazos que ve el servidor
curl.exe -H "Authorization: Bearer $t" http://127.0.0.1:8000/decks
```

**Poner la colección al día** (una sola vez, con el servidor parado y Anki cerrado):

```powershell
cd C:\dev\kotodex\server
.\deploy\windows\clone-desktop-collection.ps1      # copia la de escritorio: minutos
.env\Scripts\python.exe deployirst-sync.py     # alternativa: descargar de AnkiWeb, horas
```

**Backup.** El respaldo de verdad es AnkiWeb (`/sync`). Para una copia local hay que **parar el
servidor antes**: Anki bloquea el SQLite en exclusiva y copiarlo en caliente deja el fichero
incompleto o cuelga el proceso.

```powershell
# 1. parar el servidor (arriba)
Copy-Item C:\dev\kotodex\server\data -Destination "C:\backups\kotodex-$(Get-Date -Format yyyyMMdd)" -Recurse
# 2. volver a arrancarlo
```

---

## Cuando algo falla

| Síntoma | Causa y arreglo |
| --- | --- |
| «No se pudo conectar con el servidor» en la PWA | El portátil está dormido o apagado; Tailscale caído en el móvil; o falta el origen en `KOTODEX_CORS_ORIGINS`. |
| «Token incorrecto» | El de Ajustes no coincide con `server\.env`. |
| Las tarjetas salen sin audio | Anki de escritorio cerrado, o `KOTODEX_AUDIO_URLS` comentado. Mira `audio` en `/health`. |
| `/sync` devuelve 409 | O faltan credenciales de AnkiWeb, o AnkiWeb pide sincronización completa: resuélvela en el ordenador o en AnkiMobile. |
| No llega el aviso del sync | Mira `kotodex.err.log`: si dice «hay un aviso pero no hay forma de mandarlo», falta configurar SMTP o el webhook. El mismo aviso no se repite hasta pasadas 12 h. |
| El servidor no arranca | `Get-Content server\data\kotodex.err.log -Tail 30`. Si dice que no puede abrir la colección, hay otro proceso con ella abierta. |
| `npm run dev` se queda colgado en "scanning dependencies" | Falta `optimizeDeps.entries` en vite.config.ts: Vite intenta recorrer los ~200.000 ficheros de `server/data`. |
| El puerto 5173 responde pero no carga | Ha quedado un Vite zombi. `Get-NetTCPConnection -State Listen -LocalPort 5173 \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` |
| `'X' は認識されていません` | Estás en cmd en vez de PowerShell, o falta refrescar el PATH. |
| iOS ha borrado los diccionarios | Pasa si la PWA no se usa desde el icono de la pantalla de inicio. Reimportar los .zip desde Archivos. |
