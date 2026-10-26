# The one elevated step of an extynt install: writes the plugin into each After Effects Plug-ins folder and the release
# host library under %PROGRAMDATA%\extynt (administrators write it, everyone reads it). install.ps1 and uninstall.ps1
# start this script through Invoke-ElevatedStep; run it by hand only from an elevated PowerShell.
#
#   elevated-step.ps1 -Action Install -HostSource <dir with manifest.json> [-PluginSource <extyntcore.aex>] -LogFile <path>
#   elevated-step.ps1 -Action Uninstall -LogFile <path>
#
# Exit codes: 0 done, 2 failed (the log says why), 3 done except the plugin because no After Effects 2025 or later was found.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Install', 'Uninstall')][string]$Action,
  [string]$HostSource = '',
  [string]$PluginSource = '',
  [string]$LogFile = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'elevated-parts.ps1')

if (-not (Test-Administrator)) {
  Write-StepLog 'this step must run elevated'
  exit 2
}
try {
  $code = if ($Action -eq 'Install') { Invoke-ElevatedInstall $HostSource $PluginSource } else { Invoke-ElevatedUninstall }
} catch {
  Write-StepLog "failed: $($_.Exception.Message)"
  exit 2
}
exit $code
