# The steps of elevated-step.ps1 (dot-sourced after common.ps1). Everything here runs as an administrator.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-StepLog([string]$Message) {
  Write-Host $Message
  if ($LogFile) { Add-Content -Path $LogFile -Value $Message }
}

# Administrators and SYSTEM write, users read: a standard user must not be able to replace the library a release plugin trusts.
function Protect-ReleaseHostParent {
  New-Item -ItemType Directory -Force $ReleaseHostParent | Out-Null
  $grants = @('*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX')
  Invoke-Required 'icacls.exe' (@($ReleaseHostParent, '/inheritance:r', '/grant:r') + $grants) 'restricting the host library folder'
}

function Install-ReleaseHostLibrary([string]$Source) {
  if (-not $Source -or -not (Test-Path (Join-Path $Source 'manifest.json'))) { throw "the host library source '$Source' has no manifest.json" }
  Protect-ReleaseHostParent
  $destination = Join-Path $ReleaseHostParent 'host'
  $staged = "$destination.new"
  Remove-Item $staged -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item $Source $staged -Recurse
  Switch-Directory $staged $destination
  Write-StepLog "installed the host library at $destination"
}

# Copies the plugin into every supported After Effects install and proves each copy by hash. Returns the folders written.
function Install-PluginFiles([string]$Source) {
  if (-not (Test-Path $Source)) { throw "the plugin '$Source' does not exist" }
  $expected = (Get-FileHash $Source -Algorithm SHA256).Hash
  $folders = @(Get-AfterEffectsPluginFolders)
  foreach ($folder in $folders) {
    New-Item -ItemType Directory -Force $folder | Out-Null
    $target = Join-Path $folder $PluginFileName
    Copy-Item $Source $target -Force
    if ((Get-FileHash $target -Algorithm SHA256).Hash -ne $expected) { throw "$target does not match the plugin that was copied" }
    Write-StepLog "installed the plugin at $target"
  }
  return $folders
}

function Invoke-ElevatedInstall([string]$HostLibrary, [string]$Plugin) {
  Install-ReleaseHostLibrary $HostLibrary
  if (-not $Plugin) { return 0 }
  $folders = @(Install-PluginFiles $Plugin)
  if ($folders.Count -eq 0) {
    Write-StepLog 'no After Effects 2025 or later was found under Program Files\Adobe; the plugin was not installed (run the installer again after installing it)'
    return 3
  }
  return 0
}

function Invoke-ElevatedUninstall {
  foreach ($folder in @(Get-AfterEffectsPluginFolders)) {
    if (Test-Path $folder) { Remove-Item $folder -Recurse -Force; Write-StepLog "removed $folder" }
  }
  if (Test-Path $ReleaseHostParent) { Remove-Item $ReleaseHostParent -Recurse -Force; Write-StepLog "removed $ReleaseHostParent" }
  return 0
}
