# Shared by install.ps1, uninstall.ps1, verify.ps1 and elevated-step.ps1 (dot-sourced): state locations and small helpers.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$TaskPrefix = 'extynt sidecar'
$TaskName = "$TaskPrefix " + ($env:USERNAME -replace '[^A-Za-z0-9._-]', '_')
$StateRoot = Join-Path $env:LOCALAPPDATA 'extynt'
$SessionFile = Join-Path $StateRoot 'session.json'
$SupervisorStopFile = Join-Path $StateRoot 'supervisor.stop'
$UiRoot = Join-Path $StateRoot 'ui'
$BinRoot = Join-Path $StateRoot 'bin'
$ReleaseHostParent = Join-Path $env:ProgramData 'extynt'
$PluginFileName = 'extyntcore.aex'
$ProgramFilesRoot = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }

# Runs a native program and returns { Code, Output } without letting its stderr text become a terminating error.
function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $FilePath @Arguments 2>&1
    return [pscustomobject]@{ Code = $LASTEXITCODE; Output = ($output | Out-String).Trim() }
  } finally {
    $ErrorActionPreference = $previous
  }
}

# Runs a native program and throws, naming what it was doing, when its exit code is not zero.
function Invoke-Required([string]$FilePath, [string[]]$Arguments, [string]$What) {
  $result = Invoke-Native $FilePath $Arguments
  if ($result.Code -ne 0) { throw "$What failed (exit code $($result.Code)): $($result.Output)" }
}

function Invoke-Schtasks([string[]]$Arguments) {
  return Invoke-Native (Join-Path ([Environment]::GetFolderPath('System')) 'schtasks.exe') $Arguments
}

# Ends every process running this node.exe: ending the task leaves the sidecar's running, and an MCP client may have
# started one too. Windows will not delete or replace an executable while it runs.
function Stop-BundledNode([string]$NodePath) {
  Get-Process -Name 'node' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $NodePath } |
    ForEach-Object { Stop-Process -Id $_.Id -Force; $_.WaitForExit(5000) | Out-Null }
}

# Touches the stop marker of the account whose state folder is given. A supervisor that started before it restarts nothing
# more, whether or not schtasks /End reaches it; one started afterwards ignores it. Call it before every /End.
function Set-SupervisorStop([string]$Root) {
  New-Item -ItemType Directory -Force $Root | Out-Null
  [IO.File]::WriteAllText((Join-Path $Root 'supervisor.stop'), [DateTime]::UtcNow.ToString('o'))
}

function Test-TaskRegistered {
  return (Invoke-Schtasks @('/Query', '/TN', $TaskName)).Code -eq 0
}

# The names of every scheduled task of this product, whichever account registered it.
function Get-SidecarTaskNames {
  $listing = Invoke-Schtasks @('/Query', '/FO', 'CSV', '/NH')
  if ($listing.Code -ne 0) { return @() }
  $pattern = '^"\\(' + [regex]::Escape($TaskPrefix) + '[^"]*)"'
  return @($listing.Output -split "`r?`n" | ForEach-Object { if ($_ -match $pattern) { $Matches[1] } })
}

# The %LOCALAPPDATA%\extynt folder of every account with a sidecar task. Each task runs <folder>\bin\run-sidecar.cmd, so the
# account's own install records where its state is, and an administrator's uninstall can find it (the per-user step cannot
# write to the administrator's profile, and the uninstaller cannot run as that account).
function Get-SidecarStateRoots {
  return @(Get-SidecarTaskNames | ForEach-Object {
      $definition = (Invoke-Schtasks @('/Query', '/TN', $_, '/XML')).Output
      if ($definition -match '([A-Za-z]:\\[^<>"\r\n]*\\extynt)\\bin\\run-sidecar\.cmd') { $Matches[1] }
    } | Select-Object -Unique)
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# The value of a property, or $null when the object does not have it (strict mode makes a plain read of a missing property an error).
function Get-Property($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $null
}

# The pairing file the sidecar writes: { port, token }, or $null when it is absent or unreadable.
function Read-Session {
  if (-not (Test-Path $SessionFile)) { return $null }
  try {
    $session = Get-Content $SessionFile -Raw | ConvertFrom-Json
    if ((Get-Property $session 'port') -and (Get-Property $session 'token')) { return $session }
  } catch {
    return $null
  }
  return $null
}

function Invoke-Health($Session) {
  $headers = @{ Authorization = "Bearer $($Session.token)" }
  $uri = "http://127.0.0.1:$($Session.port)/health"
  try {
    $response = Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 3
    return $response.Content | ConvertFrom-Json
  } catch {
    return $null
  }
}

# Beta builds of After Effects count; releases older than 2025 are not supported (the sidecar refuses to pair below 25).
function Test-SupportedAfterEffects([string]$Name) {
  if ($Name -match 'After Effects (\d{4})') { return [int]$Matches[1] -ge 2025 }
  return $Name -match 'Beta'
}

function Get-AfterEffectsPluginFolders {
  $adobe = Join-Path $ProgramFilesRoot 'Adobe'
  if (-not (Test-Path $adobe)) { return @() }
  $installs = @(Get-ChildItem $adobe -Directory -Filter 'Adobe After Effects*' | Where-Object { Test-SupportedAfterEffects $_.Name })
  return @($installs | ForEach-Object { Join-Path $_.FullName 'Support Files\Plug-ins\extynt' })
}

function ConvertTo-FileUri([string]$Path) {
  return ([Uri]$Path).AbsoluteUri
}

function Write-TextFile([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

# Replaces the directory with the staged copy: stage beside it, swap, remove the old one.
function Switch-Directory([string]$Staged, [string]$Destination) {
  $old = "$Destination.old"
  Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $Destination) { Move-Item $Destination $old }
  Move-Item $Staged $Destination
  Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
}

function ConvertTo-Argument([string]$Value) {
  return '"' + $Value + '"'
}

# Runs elevated-step.ps1 (which writes the plugin and the release host library) in Windows PowerShell with one UAC prompt
# when this session is not already elevated. Returns the step's exit code: 0 done, 2 failed, 3 done but no After Effects found.
function Invoke-ElevatedStep([string]$Action, [string]$HostSource, [string]$PluginSource) {
  $log = Join-Path $StateRoot 'elevated-step.log'
  Remove-Item $log -Force -ErrorAction SilentlyContinue
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-Argument (Join-Path $PSScriptRoot 'elevated-step.ps1')), '-Action', $Action, '-LogFile', (ConvertTo-Argument $log))
  if ($HostSource) { $arguments += @('-HostSource', (ConvertTo-Argument $HostSource)) }
  if ($PluginSource) { $arguments += @('-PluginSource', (ConvertTo-Argument $PluginSource)) }
  $powershell = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
  $start = @{ FilePath = $powershell; ArgumentList = $arguments; Wait = $true; PassThru = $true; WindowStyle = 'Hidden' }
  if (-not (Test-Administrator)) { $start.Verb = 'RunAs' }
  $process = Start-Process @start
  if ($process.ExitCode -ne 0 -and (Test-Path $log)) { Get-Content $log | ForEach-Object { Write-Host "  elevated: $_" } }
  return $process.ExitCode
}

# The pid of the hidden catalogue engine: the engine's plugin writes it to native-engine.json in the state folder. It counts only
# while that process is a live AfterFX.exe; every other AfterFX.exe is the user's. No command line is read (an elevated After
# Effects hides its own from a non-elevated reader). Returns 0 when there is no engine.
function Get-CatalogueEnginePid([string]$Root = $StateRoot) {
  $file = Join-Path $Root 'native-engine.json'
  if (-not (Test-Path $file)) { return 0 }
  try { $enginePid = [int](Get-Content -Raw $file | ConvertFrom-Json).pid } catch { return 0 }
  if ($enginePid -le 0) { return 0 }
  $process = Get-Process -Id $enginePid -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'AfterFX') { return $enginePid }
  return 0
}

# Ends the hidden After Effects the sidecar started to learn the effect catalogue, by pid and with its children, never by name:
# the user may have After Effects open. Returns how many engines were ended (0 or 1).
function Stop-CatalogueEngines {
  $enginePid = Get-CatalogueEnginePid
  if ($enginePid -eq 0) { return 0 }
  Invoke-Native (Join-Path ([Environment]::GetFolderPath('System')) 'taskkill.exe') @('/PID', [string]$enginePid, '/T', '/F') | Out-Null
  return 1
}

# Ends the effect catalogue window ("extynt Catalogue.exe") of this install: Windows will not replace or delete a running exe.
function Stop-CatalogueWindow([string]$ExePath) {
  Get-Process -Name 'extynt Catalogue' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $ExePath } |
    ForEach-Object { Stop-Process -Id $_.Id -Force; $_.WaitForExit(5000) | Out-Null }
}
