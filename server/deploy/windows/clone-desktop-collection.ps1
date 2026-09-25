# Clona la coleccion de Anki de escritorio en la del servidor.
#
# Por que esto en vez de first-sync.py: tu coleccion de escritorio YA esta sincronizada con
# AnkiWeb, asi que copiarla en local deja al servidor en el mismo estado que una descarga
# completa, pero en minutos en vez de horas y sin depender de la red. A partir de ahi
# POST /sync ya es incremental, igual que en cualquier otro dispositivo.
#
# ANTES: sincroniza Anki de escritorio (coleccion Y media), cierralo, y para el servidor.
#
# Uso:  .\clone-desktop-collection.ps1

$ErrorActionPreference = "Stop"

$ServerDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Destino = Join-Path $ServerDir "data"

# --- Comprobaciones previas
if (Get-Process -Name anki -ErrorAction SilentlyContinue) {
    throw "Anki de escritorio esta abierto. Cierralo: mientras corra tiene la coleccion bloqueada."
}
$servidor = Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='uvicorn.exe'" |
    Where-Object { $_.CommandLine -like "*app.main*" }
if ($servidor) {
    throw "El servidor kotodex esta corriendo. Paralo antes (ver COMANDOS.md)."
}

# --- Localizar el perfil de Anki
$anki2 = Join-Path $env:APPDATA "Anki2"
$perfiles = @(Get-ChildItem $anki2 -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "collection.anki2") })
if ($perfiles.Count -eq 0) { throw "No se encontro ninguna coleccion en $anki2" }
if ($perfiles.Count -gt 1) {
    Write-Output "Hay varios perfiles:"
    $perfiles | ForEach-Object { Write-Output "  - $($_.Name)" }
    $elegido = Read-Host "Cual"
    $origen = $perfiles | Where-Object { $_.Name -eq $elegido } | Select-Object -First 1
    if (-not $origen) { throw "Perfil no valido" }
} else {
    $origen = $perfiles[0]
}

$col = Join-Path $origen.FullName "collection.anki2"
$media = Join-Path $origen.FullName "collection.media"
$mediaDb = Join-Path $origen.FullName "collection.media.db2"

$tamCol = (Get-Item $col).Length / 1MB
$tamMedia = 0; $numMedia = 0
if (Test-Path $media) {
    $m = Get-ChildItem $media -File -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
    $tamMedia = $m.Sum / 1GB; $numMedia = $m.Count
}

Write-Output ""
Write-Output "Origen:  $($origen.FullName)"
Write-Output ("  coleccion: {0:N0} MB" -f $tamCol)
Write-Output ("  media:     {0:N0} ficheros, {1:N1} GB" -f $numMedia, $tamMedia)
Write-Output "Destino: $Destino"
Write-Output ""
Write-Output "Esto REEMPLAZA la coleccion del servidor. La actual se guarda al lado por si acaso."
if ((Read-Host "Escribe CLONAR para continuar") -ne "CLONAR") { throw "Cancelado." }

# --- Apartar lo que haya
if (Test-Path $Destino) {
    $copia = "$Destino.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Move-Item $Destino $copia
    Write-Output "La anterior queda en: $copia"
}
New-Item -ItemType Directory -Path $Destino | Out-Null

# --- Copiar
Write-Output "Copiando la coleccion..."
Copy-Item $col (Join-Path $Destino "collection.anki2")
foreach ($ext in @("-wal", "-shm")) {
    if (Test-Path "$col$ext") { Copy-Item "$col$ext" (Join-Path $Destino "collection.anki2$ext") }
}
if (Test-Path $mediaDb) { Copy-Item $mediaDb (Join-Path $Destino "collection.media.db2") }

if (Test-Path $media) {
    Write-Output "Copiando la media ($numMedia ficheros). Esto tarda unos minutos..."
    # /NFL /NDL /NJH /NJS: sin listado por fichero, que son cientos de miles.
    robocopy $media (Join-Path $Destino "collection.media") /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy fallo con codigo $LASTEXITCODE" }
    $global:LASTEXITCODE = 0
}

Write-Output ""
Write-Output "Listo. Ahora:"
Write-Output "  1. Arranca el servidor"
Write-Output "  2. En Ajustes de la PWA: 'Crear tipo de nota' y luego 'Cargar mazos'"
Write-Output "  3. A partir de ahora, POST /sync es incremental"
