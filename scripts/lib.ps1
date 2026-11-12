# Fonctions partagées par les scripts de cycle de vie Cornelius (Windows PowerShell 5.1 et 7).
# Ce fichier se charge avec : . (Join-Path $PSScriptRoot 'lib.ps1')
Set-StrictMode -Version Latest

$ScriptRoot = $PSScriptRoot
$Root = Split-Path -Parent $ScriptRoot
$RunDir = Join-Path $Root 'data\run'
$StateFile = Join-Path $RunDir 'processes.json'
$LogDir = Join-Path $RunDir 'logs'

function Initialize-CorneliusDirs {
  foreach ($dir in @($RunDir, $LogDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
  }
}

function Get-CorneliusState {
  if (-not (Test-Path -LiteralPath $StateFile)) { return @{} }
  try {
    $raw = Get-Content -LiteralPath $StateFile -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    $data = $raw | ConvertFrom-Json
  } catch {
    return @{}
  }
  $state = @{}
  foreach ($property in $data.PSObject.Properties) {
    $value = 0
    if ([int]::TryParse([string]$property.Value, [ref]$value)) { $state[$property.Name] = $value }
  }
  return $state
}

function Set-CorneliusState {
  param([hashtable]$State)
  $object = [ordered]@{}
  foreach ($key in @('backend', 'frontend', 'perception')) {
    if ($State.ContainsKey($key) -and $State[$key]) { $object[$key] = [int]$State[$key] }
  }
  $object | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

function Test-CorneliusProcess {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $false }
  return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-CorneliusTree {
  param([int]$ProcessId)
  if (-not (Test-CorneliusProcess -ProcessId $ProcessId)) { return $false }
  & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
  return $true
}

function Get-CorneliusPortOwner {
  param([int]$Port)
  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($connection) { return [int]$connection.OwningProcess }
  return 0
}

function Get-CorneliusWorkerPids {
  $workerPids = @()
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue
  foreach ($process in $processes) {
    # Chemin absolu de CETTE installation : une autre copie de Cornelius n'est jamais touchée.
    if ($process.CommandLine -and $process.CommandLine -like "*$(Join-Path $Root 'perception\worker.py')*") {
      $workerPids += [int]$process.ProcessId
    }
  }
  return $workerPids
}

function Get-CorneliusImageWorkerPids {
  $workerPids = @()
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue
  foreach ($process in $processes) {
    if ($process.CommandLine -and $process.CommandLine.Replace('/', '\') -like "*$(Join-Path $Root 'image_generation\worker.py')*") {
      $workerPids += [int]$process.ProcessId
    }
  }
  return $workerPids
}

# Nombre d'une clé de .env, lu comme Node (--env-file) et comme lib.sh : espaces autour du signe
# égal, guillemets facultatifs, « export » et commentaire de fin de ligne admis ; la dernière
# ligne l'emporte (le serveur écoute sur celle-là).
function Get-CorneliusEnvNumber {
  param([string]$Name, [int]$Default)
  $value = $Default
  $envFile = Join-Path $Root '.env'
  if (Test-Path -LiteralPath $envFile) {
    $pattern = '^\s*(?:export\s+)?' + [regex]::Escape($Name) + '\s*=\s*["'']?(\d+)["'']?\s*(?:#.*)?$'
    foreach ($line in Get-Content -LiteralPath $envFile) {
      if ($line -match $pattern) { $value = [int]$Matches[1] }
    }
  }
  return $value
}

# Port du serveur : PORT dans .env, sinon 3000 (comme server/config.ts).
function Get-CorneliusPort {
  return Get-CorneliusEnvNumber -Name 'PORT' -Default 3000
}

# Port de l'interface de développement (Vite) : CORNELIUS_DEV_PORT dans .env, sinon 5173.
function Get-CorneliusDevPort {
  return Get-CorneliusEnvNumber -Name 'CORNELIUS_DEV_PORT' -Default 5173
}

function Resolve-CorneliusNode {
  $command = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command 'node' -ErrorAction SilentlyContinue }
  if ($command) { return $command.Source }
  return $null
}

# Vérifie ce dont le serveur a besoin ; renvoie la liste des problèmes, vide si tout va bien.
function Test-CorneliusPrerequisites {
  param([string]$Node)
  $problems = @()
  if (-not $Node) {
    $problems += 'Node.js est introuvable dans le PATH : installez Node.js 24 (fichier .nvmrc), puis rouvrez PowerShell.'
  } else {
    $version = (& $Node --version 2>$null) -replace '^v', ''
    $parts = @($version -split '\.')
    $major = 0
    $minor = 0
    if ($parts.Count -ge 2) {
      [void][int]::TryParse($parts[0], [ref]$major)
      [void][int]::TryParse($parts[1], [ref]$minor)
    }
    # Même règle que package.json (engines : >=24.2.0 <25) et que les scripts Linux.
    if ($major -ne 24 -or $minor -lt 2) {
      $problems += "Node.js $version détecté : Cornelius demande Node.js 24, à partir de 24.2 (node:sqlite, --env-file-if-exists). Voir .nvmrc."
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Root '.env'))) {
    $problems += 'Fichier .env absent : lancez « npm run setup » à la racine du projet.'
  }
  return $problems
}

# Affiche la fin des journaux d'un service, pour comprendre un arrêt au démarrage.
function Show-CorneliusLogTail {
  param([string]$Name, [int]$Lines = 25)
  foreach ($suffix in @('err', 'out')) {
    $file = Join-Path $LogDir "$Name.$suffix.log"
    if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 0) {
      Write-Host "--- $file (fin) ---"
      Get-Content -LiteralPath $file -Tail $Lines | ForEach-Object { Write-Host $_ }
    }
  }
}

# Arrête le script si le serveur ne peut pas démarrer ; renvoie sinon le chemin de Node.
function Assert-CorneliusPrerequisites {
  $node = Resolve-CorneliusNode
  $problems = @(Test-CorneliusPrerequisites -Node $node)
  if ($problems.Count -gt 0) {
    foreach ($problem in $problems) { Write-Warning $problem }
    throw 'Cornelius ne peut pas démarrer : corrigez les points ci-dessus puis relancez.'
  }
  return $node
}

function Resolve-CorneliusNpm {
  foreach ($name in @('npm.cmd', 'npm')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  return $null
}

# Dépendances npm complètes et à jour : les outils lancés par les scripts sont bien installés,
# et package-lock.json n'a pas changé depuis la dernière installation réussie (après un git pull,
# par exemple). Un npm ci interrompu, ou gêné par un fichier verrouillé sous Windows, laisse un
# node_modules incomplet : « 'tsc' n'est pas reconnu » ou « Cannot find package …\tsx\index.js ».
function Test-CorneliusDependencies {
  $modules = Join-Path $Root 'node_modules'
  $marker = Join-Path $modules '.package-lock.json'
  $shim = 'tsc'
  if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { $shim = 'tsc.cmd' }
  $required = @(
    $marker,
    (Join-Path $modules 'tsx\package.json'),
    (Join-Path $modules 'typescript\package.json'),
    (Join-Path $modules 'vite\package.json'),
    (Join-Path $modules ".bin\$shim")
  )
  foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
  }
  $lock = Join-Path $Root 'package-lock.json'
  if (-not (Test-Path -LiteralPath $lock)) { return $true }
  # npm écrit son marqueur en dernier ; quelques secondes de marge pour les horloges de fichiers.
  return (Get-Item -LiteralPath $lock).LastWriteTime -le (Get-Item -LiteralPath $marker -Force).LastWriteTime.AddSeconds(10)
}

# Installe les dépendances exactes (npm ci) si elles manquent, sont incomplètes ou ont changé.
# Cornelius est arrêté d'abord : sous Windows, un fichier ouvert par le serveur bloquerait npm ci.
function Sync-CorneliusDependencies {
  if (Test-CorneliusDependencies) { return }
  $npm = Resolve-CorneliusNpm
  if (-not $npm) { throw 'npm est introuvable dans le PATH : réinstallez Node.js 24, puis rouvrez PowerShell.' }
  Write-Host 'Dépendances absentes, incomplètes ou à mettre à jour : installation (npm ci), quelques minutes…'
  & (Join-Path $ScriptRoot 'stop.ps1')
  Push-Location $Root
  try {
    & $npm ci
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0 -or -not (Test-CorneliusDependencies)) {
    throw ("L'installation des dépendances a échoué (npm ci, code $code). Fermez ce qui utilise le " +
      'dossier du projet (éditeur, autre terminal), supprimez le dossier node_modules, puis relancez.')
  }
}

function Wait-CorneliusHttp {
  param([string]$Url, [int]$TimeoutSeconds = 60, [System.Diagnostics.Process]$Process = $null)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    # Un processus déjà terminé ne répondra jamais : inutile d'attendre la fin du délai.
    if ($Process -and $Process.HasExited) { return $false }
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -gt 0) { return $true }
    } catch {
      # Une réponse HTTP d'erreur (401…) prouve que le serveur écoute. Sous PowerShell 7,
      # un refus de connexion n'a pas de propriété Response : la lire directement échouerait
      # en mode strict.
      $response = $_.Exception.PSObject.Properties['Response']
      if ($response -and $response.Value) { return $true }
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# Lance un processus détaché, journaux dans data\run\logs.
function Start-CorneliusService {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )
  $stdout = Join-Path $LogDir "$Name.out.log"
  $stderr = Join-Path $LogDir "$Name.err.log"
  $options = @{
    FilePath               = $FilePath
    ArgumentList           = $Arguments
    WorkingDirectory       = $WorkingDirectory
    PassThru               = $true
    RedirectStandardOutput = $stdout
    RedirectStandardError  = $stderr
  }
  # -WindowStyle n'existe que sous Windows (PowerShell 5.1 ou 7).
  if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { $options['WindowStyle'] = 'Hidden' }
  $process = Start-Process @options
  # Lire le handle tout de suite : sans lui, ExitCode reste vide une fois le processus terminé.
  $null = $process.Handle
  return $process
}

# Serveur (Fastify) sur le port de .env, sauf s'il écoute déjà. Node directement, sans npm.cmd :
# le PID suivi est celui du serveur et les erreurs de démarrage arrivent telles quelles dans
# backend.err.log. Renvoie le processus lancé, ou $null si le serveur tournait déjà.
function Start-CorneliusBackend {
  param([hashtable]$State, [int]$Port, [string]$Node)
  $backendPid = Get-CorneliusPortOwner -Port $Port
  if ($backendPid -gt 0 -and (Test-CorneliusProcess -ProcessId $backendPid)) {
    $State['backend'] = $backendPid
    Write-Host "Backend déjà actif sur le port $Port (PID $backendPid)."
    return $null
  }
  $process = Start-CorneliusService -Name 'backend' -FilePath $Node `
    -Arguments @('--env-file-if-exists=.env', '--import', 'tsx', 'server/index.ts') -WorkingDirectory $Root
  $State['backend'] = $process.Id
  Write-Host "Backend lancé (PID $($process.Id))."
  return $process
}

# Perception locale (worker Python de .venv), sauf si elle tourne déjà.
function Start-CorneliusPerception {
  param([hashtable]$State)
  $python = Join-Path $Root '.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $python)) {
    Write-Warning "Python de perception introuvable : $python. Suivez docs/installation/windows.md (venv + requirements)."
    return
  }
  $workerPids = @(Get-CorneliusWorkerPids)
  if ($workerPids.Count -gt 0) {
    $State['perception'] = $workerPids[0]
    Write-Host "Perception déjà active (PID $($workerPids -join ', '))."
    return
  }
  $process = Start-CorneliusService -Name 'perception' -FilePath $python `
    -Arguments @("`"$(Join-Path $Root 'perception\worker.py')`"") -WorkingDirectory $Root
  $State['perception'] = $process.Id
  Write-Host "Perception lancée (PID $($process.Id))."
}

# Attend /api/health ; en cas d'échec, dit si le serveur s'est arrêté et affiche son journal.
function Wait-CorneliusBackend {
  param([int]$Port, [int]$TimeoutSeconds = 60, [System.Diagnostics.Process]$Process = $null)
  if (Wait-CorneliusHttp -Url "http://127.0.0.1:$Port/api/health" -TimeoutSeconds $TimeoutSeconds -Process $Process) {
    Write-Host "Backend  prêt : http://127.0.0.1:$Port"
    return $true
  }
  if ($Process -and $Process.HasExited) {
    Write-Warning "Le backend s'est arrêté au démarrage (code $($Process.ExitCode))."
  } else {
    Write-Warning "Backend non confirmé après $TimeoutSeconds s."
  }
  Show-CorneliusLogTail -Name 'backend'
  return $false
}
