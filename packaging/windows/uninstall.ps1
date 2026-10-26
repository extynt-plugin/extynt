# Stops and removes every extynt sidecar task, launchers and served UI, for every Windows account that has one.
#
#   packaging\windows\uninstall.ps1 [-System] [-Purge]
#
# -System also removes the plugin from every After Effects install and the release host library under
# %PROGRAMDATA%\extynt, in one elevated step (a UAC prompt). The Inno Setup uninstaller removes those itself.
# -Purge also deletes everything else under each account's %LOCALAPPDATA%\extynt except the installed bundle (app\), which
# the uninstaller removes itself: llm.env (the model API key), chat history, settings, logs and the WebView2 profile.
# Without -Purge those stay, so a reinstall keeps the user's settings.
# Each account's state folder is found from its own scheduled task (see Get-SidecarStateRoots in common.ps1), so an
# administrator who is not the installing account still removes the state the installing account created.
# A checkout install's plugin can also be removed with native\extynt-core\build-win.ps1 -Action Uninstall.
[CmdletBinding()]
param(
  [switch]$System,
  [switch]$Purge
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'common.ps1')

$stateRoots = @(@($StateRoot) + @(Get-SidecarStateRoots) | Select-Object -Unique)
$tasks = @(Get-SidecarTaskNames)
foreach ($root in $stateRoots) { Set-SupervisorStop $root }
foreach ($task in $tasks) {
  Invoke-Schtasks @('/End', '/TN', $task) | Out-Null
  Invoke-Schtasks @('/Delete', '/TN', $task, '/F') | Out-Null
}
if ($tasks.Count -gt 0) { Write-Host "Stopped and removed the scheduled task(s): $($tasks -join ', ')." }
else { Write-Host "No scheduled task named '$TaskPrefix*' was registered." }
Stop-BundledNode (Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\node.exe')
Stop-CatalogueWindow (Join-Path (Split-Path $PSScriptRoot -Parent) 'catalogue-window\extynt Catalogue.exe')
$engines = Stop-CatalogueEngines
if ($engines -gt 0) { Write-Host "Stopped $engines hidden After Effects engine instance(s)." }

# The served UI, launchers and session file of one account; with -Purge, everything else in its state folder too.
function Remove-AccountState([string]$Root) {
  foreach ($path in @((Join-Path $Root 'ui'), (Join-Path $Root 'bin'), (Join-Path $Root 'session.json'))) {
    Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($Purge -and (Test-Path $Root)) {
    Get-ChildItem $Root -Force | Where-Object { $_.Name -ne 'app' } | Remove-Item -Recurse -Force
  }
}

foreach ($root in $stateRoots) { Remove-AccountState $root }
if ($System) {
  $code = Invoke-ElevatedStep 'Uninstall' '' ''
  if ($code -ne 0) { Write-Error "uninstall.ps1: the elevated step failed (exit code $code); see $StateRoot\elevated-step.log."; exit 1 }
}
if ($Purge) {
  Write-Host "Deleted the settings, logs and profile under $($stateRoots -join ', ')."
} else {
  Write-Host "The settings, logs and profile under $($stateRoots -join ', ') were left in place (-Purge deletes them)."
}
Write-Host 'Unregister the MCP server in each agent that has it (remove the extynt entry from its MCP configuration).'
