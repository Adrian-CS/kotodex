# Arranca el servidor en Windows leyendo server\.env.
# Lo usa la tarea programada que crea install-task.ps1, pero también sirve suelto para probar.

$ErrorActionPreference = "Stop"

$ServerDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EnvFile = Join-Path $ServerDir ".env"
$Uvicorn = Join-Path $ServerDir "venv\Scripts\uvicorn.exe"
$DataDir = Join-Path $ServerDir "data"

if (-not (Test-Path $Uvicorn)) {
    throw "No existe $Uvicorn. Crea el entorno: python -m venv venv; .\venv\Scripts\pip install -r requirements.txt"
}
if (-not (Test-Path $EnvFile)) {
    throw "No existe $EnvFile. Copia .env.example a .env y rellena KOTODEX_TOKEN."
}
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }

# El .env lleva nombres de mazo en japonés, así que se lee como UTF-8 sí o sí.
foreach ($line in (Get-Content $EnvFile -Encoding UTF8)) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
    $split = $trimmed.IndexOf("=")
    if ($split -lt 1) { continue }
    $name = $trimmed.Substring(0, $split).Trim()
    $value = $trimmed.Substring($split + 1).Trim()
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
}

# Que Python no use la codificación del sistema (cp932 en un Windows japonés).
[Environment]::SetEnvironmentVariable("PYTHONUTF8", "1", "Process")
[Environment]::SetEnvironmentVariable("PYTHONIOENCODING", "utf-8", "Process")
[Environment]::SetEnvironmentVariable("PYTHONPATH", $ServerDir, "Process")

Set-Location $ServerDir

# UN SOLO WORKER: la librería anki bloquea la colección en exclusiva.
# Solo escucha en localhost; quien lo expone es Tailscale.
Start-Process -FilePath $Uvicorn `
    -ArgumentList "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--workers", "1" `
    -NoNewWindow -Wait `
    -RedirectStandardOutput (Join-Path $DataDir "kotodex.log") `
    -RedirectStandardError (Join-Path $DataDir "kotodex.err.log")
