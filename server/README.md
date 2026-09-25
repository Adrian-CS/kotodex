# Servidor de Anki (kotodex)

API que crea notas de Anki para la PWA, con la colección **persistente en disco** para que el sync
con AnkiWeb sea incremental y no completo. Un solo usuario, detrás de Cloudflare Tunnel.

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

Los pasos son los mismos en una e2-micro de GCP, un VPS japonés (ConoHa, Sakura) o un mini PC en
casa. Se asume Debian/Ubuntu.

```bash
sudo adduser --system --group --home /opt/kotodex kotodex
sudo -u kotodex mkdir -p /opt/kotodex/{data,backups}
# Copiar server/ y notetype/ a /opt/kotodex/
cd /opt/kotodex/server
sudo -u kotodex python3 -m venv venv
sudo -u kotodex ./venv/bin/pip install -r requirements.txt
sudo -u kotodex cp .env.example .env && sudoedit .env   # KOTODEX_TOKEN, CORS, AnkiWeb

sudo cp deploy/kotodex-anki.service /etc/systemd/system/
sudo systemctl enable --now kotodex-anki
curl localhost:8000/health
```

Con **1 GB de RAM** (la e2-micro va justa) conviene añadir swap antes:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Después, una sola vez, crear el tipo de nota:

```bash
curl -X POST -H "Authorization: Bearer $KOTODEX_TOKEN" localhost:8000/notetype/ensure
```

### Cloudflare Tunnel

El túnel sale de la máquina hacia Cloudflare, así que **no hace falta abrir puertos ni tener IP
pública entrante**. Ver `deploy/cloudflared-config.yml`.

Dos avisos:

- **No pongas Cloudflare Access interactivo en el hostname de la API.** El navegador manda un
  preflight `OPTIONS` sin credenciales y Access lo tumba, así que la PWA deja de funcionar. Quien
  autentica aquí es el bearer token. Si quieres Access igualmente, hay que activarle a mano las
  opciones de CORS en la aplicación de Access.
- `KOTODEX_CORS_ORIGINS` tiene que llevar el origen exacto de la PWA (`https://…pages.dev` o tu
  dominio). Sin eso el navegador bloquea las peticiones aunque el servidor responda bien.

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

`KOTODEX_AUDIO_DIRS` son los directorios del pack y `KOTODEX_AUDIO_PATTERNS` los patrones de
búsqueda, con `{expression}` y `{reading}`, resueltos como glob y probados en orden. Cada pack
(JPod101, NHK, Forvo) ordena los ficheros a su manera, así que ajusta los patrones al tuyo en vez
de tocar el código. Sin directorios configurados, las notas se crean sin audio.

## Variables de entorno

Ver `.env.example`. La única obligatoria es `KOTODEX_TOKEN`; el servidor no arranca sin ella.
