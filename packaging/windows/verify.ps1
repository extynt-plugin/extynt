# Checks an installation: the served UI, the host library, the scheduled task, the sidecar, the WebView2 runtime and the
# plugin. Exits 1 when a check fails.
#   packaging\windows\verify.ps1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'verify-parts.ps1')

Test-ScheduledTask
Test-ServedUi
Test-HostLibraries
$session = Wait-ForSidecar
if ($session) { Test-ServedPage $session }
Test-WebView2Runtime
Show-HostState
if ($script:Failures -ne 0) {
  Write-Error "$($script:Failures) check(s) failed."
  exit 1
}
Write-Host 'All checks passed.'
