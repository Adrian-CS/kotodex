# Reinicia el servidor. Hace falta cada vez que se toca el .env (CORS, audio, AnkiWeb).
# Vale tanto si arrancaste con install-startup.ps1 como a mano.
# Con la tarea programada (install-task.ps1) usa en su lugar:
#   Stop-ScheduledTask -TaskName kotodex-anki; Start-ScheduledTask -TaskName kotodex-anki

$ErrorActionPreference = "Stop"
$Start = Join-Path $PSScriptRoot "start-kotodex.ps1"
if (-not (Test-Path $Start)) { throw "No se encuentra $Start" }

# Solo los procesos de este servidor, no cualquier python que tengas abierto.
$vivos = Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='uvicorn.exe'" |
    Where-Object { $_.CommandLine -like "*app.main*" }
foreach ($p in $vivos) {
    Write-Output "Parando PID $($p.ProcessId)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800

Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$Start

# Esperar a que responda antes de dar por bueno el reinicio.
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing -TimeoutSec 3
        Write-Output "Servidor arriba: $($r.Content)"
        return
    } catch { }
}
Write-Output "No responde todavia. Mira server\data\kotodex.err.log"
