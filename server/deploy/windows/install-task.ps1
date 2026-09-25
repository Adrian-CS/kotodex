# Registra el servidor como tarea programada para que arranque solo al iniciar sesion.
# NECESITA POWERSHELL COMO ADMINISTRADOR.
# Si prefieres no usar administrador, usa install-startup.ps1 en su lugar.
#
# Ejecutar una vez:  .\install-task.ps1
# Quitarla:          Unregister-ScheduledTask -TaskName kotodex-anki -Confirm:$false

$ErrorActionPreference = "Stop"

$TaskName = "kotodex-anki"
$Start = Join-Path $PSScriptRoot "start-kotodex.ps1"
if (-not (Test-Path $Start)) { throw "No se encuentra $Start" }

$esAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    throw ("Hace falta PowerShell como administrador. Cierra esta ventana, busca PowerShell en el menu " +
           "Inicio, pulsa con el boton derecho y elige 'Ejecutar como administrador'. " +
           "O usa install-startup.ps1, que no lo necesita.")
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Start`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

# Sin limite de tiempo (es un servidor) y que no se pare al ir con bateria.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

# -ErrorAction Stop: sin esto, un fallo de permisos no corta el script y parece que fue bien.
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "API de Anki para la PWA kotodex" -Force -ErrorAction Stop | Out-Null

Write-Output "Tarea '$TaskName' registrada."
Write-Output "Arrancarla:  Start-ScheduledTask -TaskName $TaskName"
Write-Output "Ver estado:  Get-ScheduledTask -TaskName $TaskName"
Write-Output "Registro:    server\data\kotodex.log y kotodex.err.log"
