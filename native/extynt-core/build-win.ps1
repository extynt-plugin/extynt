# Builds (and optionally installs) the extynt native core plugin on Windows: extyntcore.aex.
#
#   native\extynt-core\build-win.ps1 -AeSdkRoot C:\SDKs\AfterEffectsSDK_26.5_win [-Arch x64|arm64]
#                                    [-Action Build|Rebuild|Install|Uninstall] [-DevLibrary]
# Build is the default; Rebuild starts from a clean build folder; Install builds and copies the plugin into After Effects.
# Install and Uninstall target After Effects 2026 unless EXTYNT_AE_YEAR names another year.
# Needs Visual Studio 2022 (Desktop development with C++) and CMake on PATH or in Visual Studio. The WebView2 SDK is the
# pinned NuGet package, checked against its SHA-256 and unpacked under build\win\webview2; the AE SDK is only read from
# -AeSdkRoot. -DevLibrary builds with EXTYNT_DEV_LIBRARY=ON (reads %LOCALAPPDATA%\extynt\host): never ship such a build.
# Output: native\extynt-core\build\win\<arch>\ae\Release\extyntcore.aex and the catalogue window beside it. Signing happens on the release Setup via scripts/sign-win.sh.
# Install / Uninstall write under "C:\Program Files\Adobe\Adobe After Effects <year>\Support Files\Plug-ins\extynt", which
# needs an elevated PowerShell. Every prerequisite is checked up front.
[CmdletBinding()]
param(
  [string]$AeSdkRoot = $env:AE_SDK_ROOT,
  [ValidateSet('x64', 'arm64')][string]$Arch = 'x64',
  [ValidateSet('Build', 'Rebuild', 'Install', 'Uninstall')][string]$Action = 'Build',
  [switch]$DevLibrary
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$WebView2Version = '1.0.3485.44'
$WebView2Sha256 = 'bc09150b179246ac90189649b13be8e6b11b3ac200e817e18df106e1f3cf489e'
$PluginVersion = if ($env:EXTYNT_PLUGIN_VERSION) { $env:EXTYNT_PLUGIN_VERSION } else { '0.1.0' }
$AeYear = if ($env:EXTYNT_AE_YEAR) { $env:EXTYNT_AE_YEAR } else { '2026' }
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildRoot = Join-Path $Here 'build\win'
$InstallDir = Join-Path $env:ProgramFiles "Adobe\Adobe After Effects $AeYear\Support Files\Plug-ins\extynt"

function Stop-Build([string]$Message) {
  Write-Error "build-win.ps1: ERROR: $Message"
  exit 1
}

function Write-Note([string]$Message) {
  Write-Host "build-win.ps1: $Message"
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { Stop-Build "$Command failed with exit code $LASTEXITCODE" }
}

function Find-Cmake {
  $onPath = Get-Command cmake -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $bundled = Join-Path ${env:ProgramFiles} 'Microsoft Visual Studio\2022\*\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
  $found = Get-ChildItem $bundled -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.FullName }
  Stop-Build 'cmake not found. Install CMake (winget install Kitware.CMake) or the Visual Studio 2022 CMake component.'
}

function Resolve-AeSdk {
  if (-not $AeSdkRoot) { Stop-Build 'pass -AeSdkRoot (or set AE_SDK_ROOT): the unpacked After Effects SDK, read in place.' }
  $examples = Join-Path $AeSdkRoot 'Examples'
  if (-not (Test-Path (Join-Path $examples 'Headers\AE_GeneralPlug.h'))) { $examples = $AeSdkRoot }
  if (-not (Test-Path (Join-Path $examples 'Headers\AE_GeneralPlug.h'))) { Stop-Build "$AeSdkRoot has no Headers\AE_GeneralPlug.h." }
  if (-not (Test-Path (Join-Path $examples 'Resources\PiPLtool.exe'))) { Stop-Build "$examples\Resources\PiPLtool.exe is missing: use the Windows After Effects SDK." }
  return $AeSdkRoot
}

function Get-WebView2Package {
  $root = Join-Path $BuildRoot 'webview2'
  if (Test-Path (Join-Path $root 'build\native\include\WebView2.h')) { return $root }
  New-Item -ItemType Directory -Force $BuildRoot | Out-Null
  $archive = Join-Path $BuildRoot "webview2-$WebView2Version.zip"
  $url = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$WebView2Version"
  Write-Note "downloading Microsoft.Web.WebView2 $WebView2Version"
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  $actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $WebView2Sha256) {
    Remove-Item $archive -Force
    Stop-Build "WebView2 package hash mismatch ($actual); expected $WebView2Sha256."
  }
  Expand-Archive -Path $archive -DestinationPath $root -Force
  return $root
}

function Build-Plugin([string]$Sdk, [string]$WebView2) {
  $cmake = Find-Cmake
  $build = Join-Path $BuildRoot $Arch
  if ($Action -eq 'Rebuild' -and (Test-Path $build)) { Remove-Item $build -Recurse -Force }
  $platform = if ($Arch -eq 'arm64') { 'ARM64' } else { 'x64' }
  $dev = if ($DevLibrary) { 'ON' } else { 'OFF' }
  Invoke-Checked $cmake @('-S', $Here, '-B', $build, '-G', 'Visual Studio 17 2022', '-A', $platform,
    '-DEXTYNT_BUILD_PLUGIN=ON', '-DEXTYNT_BUILD_TESTS=OFF', "-DAE_SDK_ROOT=$Sdk", "-DWEBVIEW2_ROOT=$WebView2",
    "-DEXTYNT_PLUGIN_VERSION=$PluginVersion", "-DEXTYNT_DEV_LIBRARY=$dev")
  Invoke-Checked $cmake @('--build', $build, '--config', 'Release', '--parallel')
  $aex = Join-Path $build 'ae\Release\extyntcore.aex'
  if (-not (Test-Path $aex)) { Stop-Build "the build finished without $aex." }
  Write-Note "built $aex"
  $window = Join-Path $build 'catalogue-window\Release\extynt Catalogue.exe'
  if (-not (Test-Path $window)) { Stop-Build "the build finished without $window." }
  Write-Note "built $window"
  return $aex
}

function Install-Plugin([string]$Aex) {
  if (-not (Test-Administrator)) { Stop-Build "Install writes under ${InstallDir}: run this from an elevated PowerShell." }
  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  Copy-Item $Aex (Join-Path $InstallDir 'extyntcore.aex') -Force
  Write-Note "installed to $InstallDir (restart After Effects)"
}

function Uninstall-Plugin {
  if (-not (Test-Path $InstallDir)) { Write-Note "nothing to remove at $InstallDir"; return }
  if (-not (Test-Administrator)) { Stop-Build "Uninstall removes ${InstallDir}: run this from an elevated PowerShell." }
  Remove-Item $InstallDir -Recurse -Force
  Write-Note "removed $InstallDir"
}

if ($Action -eq 'Uninstall') { Uninstall-Plugin; exit 0 }
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { Stop-Build 'this script builds the Windows plugin; use build-mac.sh on macOS.' }
$sdk = Resolve-AeSdk
$webView2 = Get-WebView2Package
$aexPath = Build-Plugin $sdk $webView2
if ($Action -eq 'Install') { Install-Plugin $aexPath }
