#!/bin/sh
# Copia de seguridad local de la colección.
#
# Dos cosas que hacen que lo obvio no funcione:
#   - Anki abre el SQLite en modo exclusivo, así que otro proceso NO puede leerlo mientras el
#     servicio corre: se queda bloqueado. Hay que parar el servicio.
#   - Copiar solo collection.anki2 deja fuera las notas recientes, que están en el -wal.
#
# El respaldo de verdad es AnkiWeb (POST /sync). Esto es por si el sync se rompe.
#
# Uso: backup.sh [destino]   (por defecto /opt/kotodex/backups)

set -eu

COLLECTION="${KOTODEX_COLLECTION:-/opt/kotodex/data/collection.anki2}"
DEST="${1:-/opt/kotodex/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
SERVICE=kotodex-anki

mkdir -p "$DEST/$STAMP"

systemctl stop "$SERVICE"
# Al cerrarse limpiamente el -wal se integra, pero se copia igualmente por si acaso.
for f in "$COLLECTION" "$COLLECTION-wal" "$COLLECTION-shm"; do
    [ -f "$f" ] && cp -p "$f" "$DEST/$STAMP/"
done
MEDIA="$(dirname "$COLLECTION")/collection.media"
[ -d "$MEDIA" ] && cp -a "$MEDIA" "$DEST/$STAMP/"
systemctl start "$SERVICE"

# Conservar las 14 copias más recientes.
ls -1dt "$DEST"/*/ 2>/dev/null | tail -n +15 | xargs -r rm -rf --

echo "$DEST/$STAMP"
