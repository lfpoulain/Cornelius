# Met à jour Cornelius installé par git clone, puis le relance.
# Usage : powershell -ExecutionPolicy Bypass -File scripts\update.ps1 [-Target COMMIT] [-Check]
#   sans -Target : dernière version publiée (tag vX.Y.Z) sur main, branche distante sinon
#   -Check       : affiche la version proposée sans rien changer
# Lancé aussi par l'administration (« Mettre à jour Cornelius »), avec -FromServer.
# Seule une avance rapide est faite : des fichiers modifiés à la main bloquent la mise à jour.
# En cas d'échec, le dépôt revient au commit de départ et Cornelius est relancé.
[CmdletBinding()]
param(
  [string]$Target = '',
  [switch]$Check,
  [switch]$FromServer
)

. (Join-Path $PSScriptRoot 'lib.ps1')
Initialize-CorneliusDirs
$ErrorActionPreference = 'Stop'
$result = Join-Path $RunDir 'update-result.json'
$script:old = ''

if ($FromServer) {
  Start-Transcript -LiteralPath (Join-Path $LogDir 'update.log') -Append | Out-Null
}

function Write-UpdateResult([bool]$Ok, [string]$Message, [string]$From = '', [string]$To = '') {
  $payload = [ordered]@{
    ok = $Ok
    message = $Message
    at = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    from = $From
    to = $To
  }
  [IO.File]::WriteAllText($result, ($payload | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
}

function Stop-Update([string]$Message) {
  Write-Host $Message
  if (-not $Check) { Write-UpdateResult $false $Message $script:old $Target }
  if ($FromServer) { Stop-Transcript | Out-Null }
  exit 1
}

function Invoke-Git {
  $output = & git @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($output | Out-String).Trim()) }
  return (($output | Out-String).Trim())
}

function Test-Git {
  & git @args 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

Push-Location $Root
try {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-Update 'git est introuvable.' }
  if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
    Stop-Update "Ce dossier n'est pas un dépôt git : réinstallez avec git clone."
  }
  $script:old = Invoke-Git rev-parse HEAD
  if (Invoke-Git status --porcelain --untracked-files=no) {
    Stop-Update 'Des fichiers de Cornelius ont été modifiés à la main : mise à jour annulée (git status).'
  }
  try { Invoke-Git fetch --quiet --tags --force origin | Out-Null } catch { Stop-Update 'Dépôt de Cornelius injoignable.' }
  $branch = ''
  try { $branch = Invoke-Git symbolic-ref --short -q HEAD } catch { $branch = '' }
  if (-not $Target) {
    if (-not $branch -or $branch -eq 'main') {
      $tag = Invoke-Git for-each-ref --sort=-v:refname --count=1 '--format=%(refname:short)' 'refs/tags/v*'
      if (-not $tag) { Stop-Update 'Aucune version publiée (tag vX.Y.Z).' }
      $Target = Invoke-Git rev-parse "$tag^{commit}"
    } else {
      try { $Target = Invoke-Git rev-parse '@{u}' } catch { Stop-Update "La branche « $branch » ne suit aucune branche distante." }
    }
  }
  try { $Target = Invoke-Git rev-parse --verify "$Target^{commit}" } catch { Stop-Update "Commit introuvable : $Target" }

  if ($Target -eq $script:old -or (Test-Git merge-base --is-ancestor $Target $script:old)) {
    Write-Host 'Cornelius est déjà à jour.'
    if (-not $Check) { Write-UpdateResult $true 'Cornelius est déjà à jour.' $script:old $script:old }
    exit 0
  }
  if (-not (Test-Git merge-base --is-ancestor $script:old $Target)) {
    Stop-Update "L'historique local a divergé : mettez à jour à la main (git pull)."
  }
  $version = ''
  try { $version = ((Invoke-Git show "${Target}:package.json") | ConvertFrom-Json).version } catch { $version = '' }
  $count = Invoke-Git rev-list --count "$($script:old)..$Target"
  Write-Host "Mise à jour vers $version ($count commits)"
  Invoke-Git log '--format=  %h %s' -n 15 "$($script:old)..$Target" | Write-Host
  if ($Check) { exit 0 }

  $changed = (Invoke-Git diff --name-only $script:old $Target) -split "`r?`n"
  $restart = Join-Path $PSScriptRoot 'restart.ps1'

  try {
    # Arrêt d'abord : sous Windows, des fichiers ouverts par le serveur gêneraient la suite.
    & (Join-Path $PSScriptRoot 'stop.ps1')
    if ($branch) { Invoke-Git merge --ff-only --quiet $Target | Out-Null } else { Invoke-Git checkout --quiet --detach $Target | Out-Null }
    $python = Join-Path $Root '.venv\Scripts\python.exe'
    if ((Test-Path -LiteralPath $python) -and ($changed -contains 'perception/requirements.txt')) {
      Write-Host 'Dépendances Python modifiées : installation…'
      # Une variante GPU d'ONNX Runtime (DirectML…) reste en place : la version processeur de
      # requirements.txt l'abîmerait (docs/installation/gpu.md).
      $requirements = Join-Path $RunDir 'update-requirements.txt'
      & $python -m pip show --quiet onnxruntime 2>&1 | Out-Null
      $plainOnnx = ($LASTEXITCODE -eq 0)
      Get-Content -LiteralPath (Join-Path $Root 'perception\requirements.txt') |
        Where-Object { $plainOnnx -or $_ -notmatch '^onnxruntime==' } |
        Set-Content -LiteralPath $requirements -Encoding ascii
      & $python -m pip install --disable-pip-version-check --quiet -r $requirements
      if ($LASTEXITCODE -ne 0) { throw "pip install a échoué (code $LASTEXITCODE)." }
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $restart -Build
    if ($LASTEXITCODE -ne 0) { throw "Le redémarrage a échoué (code $LASTEXITCODE)." }
    Write-UpdateResult $true "Cornelius $version installé." $script:old $Target
    Write-Host 'Mise à jour terminée.'
  } catch {
    Write-Host "Échec : $($_.Exception.Message)"
    Write-Host 'Retour au commit de départ…'
    if ($branch) { & git reset --keep --quiet $script:old } else { & git checkout --quiet --detach $script:old }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $restart -Build
    Stop-Update 'La mise à jour a échoué, Cornelius est revenu à la version précédente (voir data\run\logs\update.log).'
  }
} finally {
  Pop-Location
  if ($FromServer) { try { Stop-Transcript | Out-Null } catch { } }
}
