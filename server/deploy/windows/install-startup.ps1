# Alternativa sin administrador: deja un acceso directo en la carpeta de Inicio, asi el servidor
# arranca al iniciar sesion. Mas simple que la tarea programada, pero no reintenta si se cae.
#
# Ejecutar una vez:  .\install-startup.ps1
# Quitarlo:          Remove-Item "$([Environment]::GetFolderPath('Startup'))\kotodex-anki.lnk"

$ErrorActionPreference = "Stop"

$Start = Join-Path $PSScriptRoot "start-kotodex.ps1"
if (-not (Test-Path $Start)) { throw "No se encuentra $Start" }
$ServerDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$destino = Join-Path ([Environment]::GetFolderPath("Startup")) "kotodex-anki.lnk"
$shell = New-Object -ComObject WScript.Shell
$acceso = $shell.CreateShortcut($destino)
$acceso.TargetPath = "powershell.exe"
$acceso.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Start`""
$acceso.WorkingDirectory = $ServerDir
$acceso.WindowStyle = 7   # minimizado
$acceso.Description = "API de Anki para la PWA kotodex"
$acceso.Save()

Write-Output "Acceso directo creado en: $destino"
Write-Output "Arrancarlo ahora sin reiniciar sesion:"
Write-Output "  Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','$Start'"
