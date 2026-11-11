# Arrête le backend, le frontend Vite, la perception locale et le worker d'images, lancés par
# scripts\start.ps1 (production) ou scripts\dev.ps1 (développement).
# Usage : powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'lib.ps1')
Initialize-CorneliusDirs

$state = Get-CorneliusState
$stopped = @()

# Processus suivis dans le fichier d'état.
foreach ($name in @('perception', 'frontend', 'backend')) {
  $processId = 0
  if ($state.ContainsKey($name)) { $processId = [int]$state[$name] }
  if ($processId -gt 0 -and (Stop-CorneliusTree -ProcessId $processId)) {
    $stopped += "$name (PID $processId)"
  }
}

# Processus orphelins : ceux qui écoutent les ports, puis les workers de perception.
foreach ($port in @((Get-CorneliusDevPort), (Get-CorneliusPort))) {
  $owner = Get-CorneliusPortOwner -Port $port
  if ($owner -gt 0 -and (Stop-CorneliusTree -ProcessId $owner)) {
    $stopped += "port $port (PID $owner)"
  }
}
foreach ($workerPid in @(Get-CorneliusWorkerPids)) {
  if (Stop-CorneliusTree -ProcessId $workerPid) { $stopped += "perception (PID $workerPid)" }
}
foreach ($workerPid in @(Get-CorneliusImageWorkerPids)) {
  if (Stop-CorneliusTree -ProcessId $workerPid) { $stopped += "génération d'image (PID $workerPid)" }
}

if (Test-Path -LiteralPath $StateFile) { Remove-Item -LiteralPath $StateFile -Force }

if ($stopped.Count -gt 0) {
  Write-Host ('Arrêté : ' + ($stopped -join ', '))
} else {
  Write-Host 'Aucun processus Cornelius actif.'
}
