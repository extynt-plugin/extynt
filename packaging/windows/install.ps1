# Installs the extynt sidecar, its served UI, the host jsx library, the MCP launcher and (from a bundle) the plugin.
#   packaging\windows\install.ps1 -BundleRoot <dir> [-UiLanguage <code>]   what the Inno Setup installer runs, from the installed bundle
#   packaging\windows\install.ps1 [-RepoRoot <checkout>] [-DevLibrary]   a developer install from a built checkout
# Run it from a normal PowerShell; Setup runs it as the user who started Setup, after writing the plugin and release
# host library itself. A checkout install takes one UAC prompt, needs node on PATH and a built checkout, and runs the
# sidecar in place, so re-run it after moving the checkout. -DevLibrary installs the host library under
# %LOCALAPPDATA%\extynt\host with no elevation. A checkout's plugin: native\extynt-core\build-win.ps1 -Action Install.
[CmdletBinding()]
param(
  [string]$RepoRoot = '',
  [string]$BundleRoot = '',
  [string]$UiLanguage = '',
  [switch]$DevLibrary
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'install-parts.ps1')

if ($BundleRoot -and $DevLibrary) { Stop-Install '-DevLibrary is for a checkout install; a bundle is always a release.' }
New-Item -ItemType Directory -Force $StateRoot | Out-Null
if ($BundleRoot) { Start-Transcript -Path (Join-Path $StateRoot 'install.log') -Force | Out-Null }

$layout = Get-InstallLayout $RepoRoot $BundleRoot
Assert-InstallLayout $layout
if ($layout.IsBundle) {
  Stop-CatalogueEngines | Out-Null
  Stop-CatalogueWindow (Join-Path $layout.Root 'catalogue-window\extynt Catalogue.exe')
  Assert-AfterEffectsClosed
}
Stop-Sidecar $layout
Install-ServedUi $layout.PanelDirectory
Install-Launchers $layout ([bool]$DevLibrary)
Install-LlmEnvironment
Write-UiLanguage $UiLanguage
Register-SidecarTask
Install-HostLibrary $layout ([bool]$DevLibrary)
Start-AndProveSidecar $layout
Open-CatalogueWindow $layout
Write-NextSteps $layout
