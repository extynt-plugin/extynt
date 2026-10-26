# The checks of verify.ps1 (dot-sourced after common.ps1).
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:Failures = 0

function Write-Pass([string]$Message) { Write-Host "OK    $Message" }
function Write-Info([string]$Message) { Write-Host "info  $Message" }
function Write-Failure([string]$Message) {
  [Console]::Error.WriteLine("FAIL  $Message")
  $script:Failures++
}

function Test-ScheduledTask {
  $query = Invoke-Schtasks @('/Query', '/TN', $TaskName, '/V', '/FO', 'LIST')
  if ($query.Code -ne 0) { Write-Failure "scheduled task '$TaskName' is not registered (run install.ps1)"; return }
  $status = ($query.Output -split "`r?`n" | Where-Object { $_ -match '^Status:' }) -join ''
  Write-Pass "scheduled task '$TaskName' registered ($($status.Trim()))"
}

function Test-ServedUi {
  $manifestPath = Join-Path $UiRoot 'ui-manifest.json'
  if (-not (Test-Path $manifestPath)) { Write-Failure "served UI missing: $manifestPath"; return }
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $bad = 0
  foreach ($file in $manifest.files) {
    $path = Join-Path $UiRoot $file.path
    if (-not (Test-Path $path)) { Write-Failure "served UI file missing: $($file.path)"; $bad++; continue }
    if ((Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { Write-Failure "served UI file differs from ui-manifest.json: $($file.path)"; $bad++ }
  }
  $extra = @(Get-ChildItem $UiRoot -Recurse -File).Count - ($manifest.files.Count + 1)
  if ($extra -ne 0) { Write-Failure "$UiRoot holds files that ui-manifest.json does not list"; $bad++ }
  if ($bad -eq 0) { Write-Pass "served UI: $($manifest.files.Count) files in $UiRoot (build $($manifest.buildId))" }
}

function Get-LibraryVersion([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path $manifestPath)) { return $null }
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if (-not (Test-Path (Join-Path $Directory $manifest.entry))) { Write-Failure "host library entry $($manifest.entry) missing in $Directory"; return 'broken' }
  return $manifest.version
}

# The release library must not be writable by a standard user, or a release plugin build could refuse it.
function Test-ReleaseLibraryAcl([string]$Directory) {
  $writable = (Get-Acl $Directory).Access | Where-Object {
    $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -match '(Users|Everyone|Authenticated Users)$' -and
    ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write)
  }
  if ($writable) { Write-Failure "the release host library $Directory is writable by $(@($writable)[0].IdentityReference)" }
}

function Test-HostLibraries {
  $release = Join-Path $ReleaseHostParent 'host'
  $development = Join-Path $StateRoot 'host'
  $releaseVersion = Get-LibraryVersion $release
  $developmentVersion = Get-LibraryVersion $development
  if ($releaseVersion) { Write-Pass "release host library $releaseVersion at $release"; Test-ReleaseLibraryAcl $release }
  if ($developmentVersion) { Write-Pass "development host library $developmentVersion at $development" }
  if (-not $releaseVersion -and -not $developmentVersion) { Write-Failure 'no host library installed; run install.ps1 (or install.ps1 -DevLibrary)' }
}

function Wait-ForSidecar {
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    $session = Read-Session
    if ($session -and (Invoke-Health $session)) {
      Write-Pass "sidecar answers /health on port $($session.port) (attempt $attempt)"
      return $session
    }
    Start-Sleep -Seconds 1
  }
  Write-Failure "the sidecar did not answer /health within 30 s (session file $SessionFile)"
  return $null
}

function Test-ServedPage($Session) {
  $base = "http://127.0.0.1:$($Session.port)"
  try {
    $page = Invoke-WebRequest -Uri "$base/ui/" -UseBasicParsing -TimeoutSec 5
    if (-not $page.Headers['Content-Security-Policy']) { Write-Failure "$base/ui/ carries no Content-Security-Policy" }
    $manifest = Get-Content (Join-Path $UiRoot 'ui-manifest.json') -Raw | ConvertFrom-Json
    $expected = ($manifest.files | Where-Object { $_.path -eq 'main.js' }).sha256
    $download = Join-Path $env:TEMP 'extynt-served-main.js'
    Invoke-WebRequest -Uri "$base/ui/main.js" -UseBasicParsing -TimeoutSec 5 -OutFile $download
    $actual = (Get-FileHash $download -Algorithm SHA256).Hash.ToLowerInvariant()
    Remove-Item $download -Force -ErrorAction SilentlyContinue
    if ($actual -eq $expected) { Write-Pass "the sidecar serves the installed UI build $($manifest.buildId)" }
    else { Write-Failure "$base/ui/main.js is not the installed main.js (a different sidecar may hold the port)" }
  } catch {
    Write-Failure "$base/ui/ did not answer: $($_.Exception.Message)"
  }
}

function Test-WebView2Runtime {
  $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  $keys = @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$guid", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid", "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid")
  foreach ($key in $keys) {
    $item = Get-ItemProperty $key -ErrorAction SilentlyContinue
    $version = Get-Property $item 'pv'
    if ($version) { Write-Pass "WebView2 runtime $version"; return }
  }
  Write-Failure 'the WebView2 Evergreen runtime is not installed (https://developer.microsoft.com/microsoft-edge/webview2/)'
}

function Show-HostState {
  $folders = Get-AfterEffectsPluginFolders | Where-Object { Test-Path (Join-Path $_ 'extyntcore.aex') }
  foreach ($folder in $folders) { Write-Info "native plugin installed: $folder\extyntcore.aex" }
  if (-not $folders) { Write-Info 'no extyntcore.aex under Program Files\Adobe\Adobe After Effects *\Support Files\Plug-ins\extynt (build-win.ps1 -Action Install)' }
  if (Test-Path (Join-Path $StateRoot 'native.json')) { Write-Info 'native.json present: After Effects with the plugin is (or was) running' }
  else { Write-Info 'native.json absent: After Effects is not running with the plugin; the sidecar reports HOST_OFFLINE until it is' }
}
