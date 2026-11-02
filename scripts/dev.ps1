# Développement : serveur (Fastify), interface Vite (port 5173 ou CORNELIUS_DEV_PORT, rechargement à chaud) et perception locale.
# Usage : powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 [-NoFrontend] [-NoPerception] [-TimeoutSeconds 60]
# Arrêt : scripts\stop.ps1. Production (interface compilée, sans Vite) : scripts\start.ps1.
[CmdletBinding()]
param(
  [switch]$NoFrontend,
  [switch]$NoPerception,
  [int]$TimeoutSeconds = 60
)

. (Join-Path $PSScriptRoot 'lib.ps1')
Initialize-CorneliusDirs

$node = Assert-CorneliusPrerequisites
Sync-CorneliusDependencies
$state = Get-CorneliusState
$port = Get-CorneliusPort
$webPort = Get-CorneliusDevPort
$frontendProcess = $null

# --- Backend (Fastify, port de .env) ----------------------------------------------
$backendProcess = Start-CorneliusBackend -State $state -Port $port -Node $node

# --- Frontend (Vite, port CORNELIUS_DEV_PORT) -------------------------------------
if ($NoFrontend) {
  Write-Host 'Frontend ignoré (-NoFrontend).'
} else {
  $frontendPid = Get-CorneliusPortOwner -Port $webPort
  if ($frontendPid -gt 0 -and (Test-CorneliusProcess -ProcessId $frontendPid)) {
    $state['frontend'] = $frontendPid
    Write-Host "Frontend déjà actif sur le port $webPort (PID $frontendPid)."
  } else {
    $frontendProcess = Start-CorneliusService -Name 'frontend' -FilePath $node `
      -Arguments @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1') -WorkingDirectory $Root
    $state['frontend'] = $frontendProcess.Id
    Write-Host "Frontend lancé (PID $($frontendProcess.Id))."
  }
}

# --- Perception locale (worker Python) --------------------------------------------
if ($NoPerception) {
  Write-Host 'Perception ignorée (-NoPerception).'
} else {
  Start-CorneliusPerception -State $state
}

Set-CorneliusState -State $state

# --- Vérification de disponibilité -------------------------------------------------
Write-Host ''
$ready = Wait-CorneliusBackend -Port $port -TimeoutSeconds $TimeoutSeconds -Process $backendProcess
if (-not $NoFrontend) {
  if (Wait-CorneliusHttp -Url "http://127.0.0.1:$webPort/" -TimeoutSeconds $TimeoutSeconds -Process $frontendProcess) {
    Write-Host "Frontend prêt : http://127.0.0.1:$webPort"
  } else {
    $ready = $false
    Write-Warning 'Frontend non confirmé.'
    Show-CorneliusLogTail -Name 'frontend'
  }
}
if (-not $ready) {
  Write-Host "Journaux complets : $LogDir"
  exit 1
}
exit 0
