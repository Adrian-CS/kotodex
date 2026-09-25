# Servidor de Anki (kotodex)

API que crea notas de Anki para la PWA, con la colección **persistente en disco** para que el sync
con AnkiWeb sea incremental y no completo. Un solo usuario, expuesto con Tailscale Funnel o Cloudflare Tunnel.

Lo que aporta frente al modo AnkiMobile (URL scheme): añade el **audio** como media, no te saca de
la app y no depende de la longitud de la URL.

## Endpoints

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/health` | Estado. Sin token, para el health check del túnel. |
| GET | `/decks` | Mazos de la colección. |
| POST | `/notetype/ensure` | Crea el tipo de nota «JP Dict» o refresca plantillas y CSS. |
| POST | `/notes` | Crea una nota. Busca el audio si hay pack configurado. |
| POST | `/sync` | Sincroniza con AnkiWeb. |

Todos menos `/health` piden `Authorization: Bearer $KOTODEX_TOKEN`.

```bash
curl -H "Authorization: Bearer $KOTODEX_TOKEN" https://anki.tudominio.com/decks
curl -X POST -H "Authorization: Bearer $KOTODEX_TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"Expression":"食べる","Reading":"たべる"},"deck":"日本語"}' \
  https://anki.tudominio.com/notes
```

## En local

```bash
cd server
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
cp .env.example .env     # rellenar al menos KOTODEX_TOKEN
set -a && . ./.env && set +a
./venv/bin/uvicorn app.main:app --reload --port 8000
./venv/bin/python -m pytest tests -q
```

## Desplegar

### Opción A — portátil con Windows (lo que usamos)

El servidor corre en el propio portátil y se expone con Tailscale. Coste fijo: cero.

```powershell
cd C:\dev\kotodex\server
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
copy .env.example .env      # rellenar KOTODEX_TOKEN
.\deploy\windows\start-kotodex.ps1
```

Para que arranque solo al iniciar sesión:

```powershell
.\deploy\windows\install-task.ps1
Start-ScheduledTask -TaskName kotodex-anki
```

El registro queda en `server\data\kotodex.log` y `kotodex.err.log`.

**Que el portátil no se duerma**, o el servidor deja de responder:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

Y el cierre de tapa: Panel de control → Opciones de energía → *Elegir el comportamiento del cierre de la
tapa* → "No hacer nada" con el portátil enchufado.

### Opción B — Linux (VM, VPS o mini PC)

```bash
sudo adduser --system --group --home /opt/kotodex kotodex
sudo -u kotodex mkdir -p /opt/kotodex/{data,backups}
# Copiar server/ y notetype/ a /opt/kotodex/
cd /opt/kotodex/server
sudo -u kotodex python3 -m venv venv
sudo -u kotodex ./venv/bin/pip install -r requirements.txt
sudo -u kotodex cp .env.example .env && sudoedit .env

sudo cp deploy/kotodex-anki.service /etc/systemd/system/
sudo systemctl enable --now kotodex-anki
curl localhost:8000/health
```

Con **1 GB de RAM** conviene añadir swap antes:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Crear el tipo de nota

Una sola vez, con el servidor ya en marcha (o desde el botón de Ajustes en la PWA):

```bash
curl -X POST -H "Authorization: Bearer $KOTODEX_TOKEN" localhost:8000/notetype/ensure
```

## Exponerlo

El servidor escucha solo en `127.0.0.1`. Hace falta algo que le dé **nombre, certificado HTTPS y
alcance desde fuera**: la PWA va por HTTPS y el navegador bloquea las llamadas a `http://`, así que
apuntar a una IP pelada no funciona.

### Tailscale (sin dominio, gratis) — lo que usamos

```powershell
winget install Tailscale.Tailscale     # o descargar de tailscale.com/download
tailscale up
tailscale serve --bg 8000
tailscale serve status
```

Te queda una URL fija del tipo `https://kotodex.tu-tailnet.ts.net`, con certificado válido, que es
la que va en Ajustes de la PWA. Para que el nombre sea bonito, renombra el equipo en la consola de
Tailscale.

Con `serve` la API **solo se ve desde tus dispositivos**: el iPhone necesita la app de Tailscale
instalada y activa. A cambio no queda nada expuesto a internet, que es lo que pide el CLAUDE.md
("Audio y API nunca públicos") y lo que mantiene el audio dentro del uso privado.

Si prefieres no depender de la app en el móvil, `tailscale funnel --bg 8000` hace lo mismo pero
accesible desde internet, protegido solo por el bearer token.

### Cloudflare Tunnel (si tienes dominio propio)

Ver `deploy/cloudflared-config.yml`. Dos avisos:

- **No pongas Cloudflare Access interactivo en el hostname de la API.** El navegador manda un
  preflight `OPTIONS` sin credenciales y Access lo tumba, así que la PWA deja de funcionar. Quien
  autentica aquí es el bearer token. Si quieres Access igualmente, hay que activarle a mano las
  opciones de CORS en la aplicación de Access.

### CORS

`KOTODEX_CORS_ORIGINS` lleva el origen de **la PWA** (`https://…pages.dev` o `http://localhost:5173`
en desarrollo), no el del servidor. Sin eso el navegador bloquea las peticiones aunque el servidor
responda bien.

## Cosas que hay que saber

- **Un solo worker de uvicorn.** La librería `anki` abre el SQLite en modo exclusivo y no es
  concurrente; con dos workers el segundo no arranca. El servicio ya lo fija con `--workers 1`.
- **La colección tiene que vivir en disco persistente** (`KOTODEX_COLLECTION`). Es lo que guarda el
  estado del sync incremental: si la pierdes, el siguiente sync es completo.
- **Cada nota se escribe al WAL al instante**, así que un corte de luz no pierde notas.
- **Los backups no se pueden hacer copiando el fichero con el servicio en marcha**: Anki lo tiene
  bloqueado en exclusiva y el proceso que lo intente se queda colgado. `deploy/backup.sh` para el
  servicio, copia y lo vuelve a arrancar. El respaldo real es AnkiWeb.
- **`/sync` no hace sincronizaciones completas.** Si AnkiWeb pide una (porque cambió el esquema en
  el otro lado), devuelve 409 y lo resuelves tú en el ordenador o en AnkiMobile. Un full sync pisa
  una de las dos colecciones entera y eso no se decide desde un endpoint.
- Añadir campos al tipo de nota es un cambio de esquema y obliga a un full sync, por eso
  `/notetype/ensure` no lo hace sin `{"force": true}`. Cambiar plantillas y CSS sí es seguro.

## Audio

Dos fuentes, en este orden:

**1. Pack local en disco** (`KOTODEX_AUDIO_DIRS` + `KOTODEX_AUDIO_PATTERNS`). Los patrones llevan
`{expression}` y `{reading}` y se resuelven como glob, probados en orden. Cada pack (JPod101, NHK,
Forvo) ordena los ficheros a su manera, así que se ajustan los patrones en vez de tocar el código.

**2. Fuentes HTTP** (`KOTODEX_AUDIO_URLS`), plantillas de URL separadas por `|`. Acepta dos tipos de
respuesta: el audio directamente, o el JSON de Yomitan `{"audioSources":[{"url":…}]}`, del que baja
el primero. Lo descargado se guarda en `KOTODEX_AUDIO_CACHE`, así que cada palabra se pide una sola
vez y la caché acaba siendo tu propio pack.

La búsqueda de audio se hace **fuera del lock** de la colección, para que una fuente lenta no
bloquee el resto de peticiones. Si no encuentra nada, la nota se crea igual con el campo vacío.

### Opciones concretas

- **El addon «Yomichan Forvo Server»** que ya está instalado en Anki de escritorio:
  `KOTODEX_AUDIO_URLS=http://localhost:8770/?term={expression}&reading={reading}`.
  Funciona sin configurar nada más, pero **solo mientras Anki de escritorio esté abierto**. Si está
  cerrado, la nota sale sin audio. Ese addon saca el audio raspando la web de Forvo, cosa que sus
  condiciones de uso no permiten; el servidor solo consume lo que la URL le devuelva.
- **La API oficial de Forvo** con clave: es la vía autorizada y no depende de tener Anki abierto.
  Se pone la clave dentro de la propia plantilla de URL.
- **Un pack descargado**: lo más rápido y funciona sin red, pero los packs que circulan son
  redistribución no autorizada de material comercial.

## Variables de entorno

Ver `.env.example`. La única obligatoria es `KOTODEX_TOKEN`; el servidor no arranca sin ella.
