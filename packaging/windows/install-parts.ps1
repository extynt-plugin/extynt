# The steps of install.ps1 (dot-sourced after common.ps1).
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$LogRotateBytes = 5242880

function Stop-Install([string]$Message) {
  Write-Error "install.ps1: $Message"
  exit 1
}

function Resolve-NodePath {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { Stop-Install 'node.exe is not on PATH. Install Node.js 26 (winget install OpenJS.NodeJS) and open a new PowerShell.' }
  return $command.Source
}

# Where everything lives for this install: a bundle (the Inno Setup installer; its own node.exe, nothing is built) or a
# built checkout (node.exe from PATH, files in place).
function Get-InstallLayout([string]$Repo, [string]$Bundle) {
  if ($Bundle) {
    $sidecar = Join-Path $Bundle 'sidecar'
    return [pscustomobject]@{
      IsBundle = $true; Root = $Bundle; Node = Join-Path $Bundle 'runtime\node.exe'
      Main = Join-Path $sidecar 'apps\sidecar\dist\src\main.js'
      Stdio = Join-Path $sidecar 'node_modules\@extynt\mcp-server\dist\src\stdio.js'
      PanelDirectory = Join-Path $Bundle 'ui'; HostSource = Join-Path $Bundle 'host'
      PluginSource = Join-Path $Bundle "plugin\$PluginFileName"; StopScript = Join-Path $sidecar 'scripts\stop-local-sidecar.ts'
    }
  }
  return [pscustomobject]@{
    IsBundle = $false; Root = $Repo; Node = Resolve-NodePath
    Main = Join-Path $Repo 'apps\sidecar\dist\src\main.js'
    Stdio = Join-Path $Repo 'packages\mcp-server\dist\src\stdio.js'
    PanelDirectory = Join-Path $Repo 'apps\panel'; HostSource = ''; PluginSource = ''
    StopScript = Join-Path $Repo 'scripts\stop-local-sidecar.ts'
  }
}

function Assert-InstallLayout($Layout) {
  $required = @($Layout.Node, $Layout.Main, $Layout.Stdio, (Join-Path $Layout.PanelDirectory 'ui-manifest.json'), $Layout.StopScript)
  if ($Layout.IsBundle) { $required += @((Join-Path $Layout.HostSource 'manifest.json'), $Layout.PluginSource) }
  else { $required += (Join-Path $Layout.Root 'apps\panel\host\probe.jsx') }
  foreach ($path in $required) {
    if (-not (Test-Path $path)) { Stop-Install "$path is missing: build the checkout first (see the header of install.ps1), or run the installer again." }
  }
}

# The plugin file is locked while After Effects runs, and the host library is read from it.
function Assert-AfterEffectsClosed {
  if (Get-Process -Name 'AfterFX' -ErrorAction SilentlyContinue) { Stop-Install 'After Effects is running. Close it and run the installer again.' }
}

# Ends the running task instance and anything still listening from this install, so no old process holds the port.
function Stop-Sidecar($Layout) {
  Set-SupervisorStop $StateRoot
  if (Test-TaskRegistered) { Invoke-Schtasks @('/End', '/TN', $TaskName) | Out-Null }
  Invoke-Required $Layout.Node @($Layout.StopScript) 'stopping the running sidecar'
  Remove-Item $SessionFile -Force -ErrorAction SilentlyContinue
}

# The served UI is exactly the files ui-manifest.json lists, plus the manifest.
function Install-ServedUi([string]$PanelDirectory) {
  $manifest = Get-Content (Join-Path $PanelDirectory 'ui-manifest.json') -Raw | ConvertFrom-Json
  $staged = "$UiRoot.new"
  Remove-Item $staged -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $staged | Out-Null
  foreach ($file in $manifest.files) {
    $target = Join-Path $staged $file.path
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Copy-Item (Join-Path $PanelDirectory $file.path) $target
    $actual = (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $file.sha256) { Stop-Install "$($file.path) does not match ui-manifest.json: run node scripts\build-panel.ts." }
  }
  Copy-Item (Join-Path $PanelDirectory 'ui-manifest.json') (Join-Path $staged 'ui-manifest.json')
  Switch-Directory $staged $UiRoot
  Write-Host "Installed the served UI ($($manifest.files.Count) files) at $UiRoot."
}

# cmd lines that move a log over $LogRotateBytes aside before the sidecar appends to it.
function Get-LogRotationLines([string[]]$Names) {
  return @($Names | ForEach-Object {
      $log = "$StateRoot\$_"
      "if exist `"$log`" for %%A in (`"$log`") do if %%~zA gtr $LogRotateBytes move /y `"$log`" `"$log.old`" >nul"
    })
}

# run-sidecar.cmd is what the task runs: it sets the environment, rotates the logs and starts windows-supervisor-main.js, which
# supervises Node (Task Scheduler's restart-on-failure covers only a task that fails to launch, and the headless conhost
# reports 0 whatever Node did, so a killed sidecar would otherwise stay dead while After Effects is closed). The supervisor
# restarts Node after a crash with a back-off of 2, 4, 8, then 16 s using timers, never a helper process, so a session
# without a console cannot turn the wait into a spin. A run of 60 s resets the back-off; the seventh failure in a row ends
# the loop (exit 1, logged once); exit 0 (a clean shutdown) ends the task. A stop marker newer than the supervisor's start
# (written before every schtasks /End) also ends it, because /End can leave the cmd and Node tree running. The task stays
# running meanwhile, so IgnoreNew keeps a second launcher from starting.
# --no-sparkplug as on macOS: Node 24's V8 can crash in a full GC with baseline frames on the stack.
# A development install (-DevLibrary) runs as development; every other install runs as production.
function Get-SidecarLauncherLines($Layout, [bool]$Development) {
  $environment = if ($Development) { @('set "NODE_ENV=development"') } else { @('set "NODE_ENV=production"') }
  $head = @('@echo off', 'chcp 65001 >nul', 'set "AE_BRIDGE_PORT=0"', "set `"EXTYNT_UI_DIRECTORY=$UiRoot`"") + $environment
  $supervisor = Join-Path (Split-Path $Layout.Main) 'windows-supervisor-main.js'
  $run = @("`"$($Layout.Node)`" `"$supervisor`" `"$SupervisorStopFile`" `"$($Layout.Main)`" >> `"$StateRoot\sidecar.log`" 2>> `"$StateRoot\sidecar.error.log`"", 'exit /b %ERRORLEVEL%')
  return $head + (Get-LogRotationLines @('sidecar.log', 'sidecar.error.log')) + $run
}

function Install-Launchers($Layout, [bool]$Development) {
  New-Item -ItemType Directory -Force $BinRoot | Out-Null
  Write-TextFile (Join-Path $BinRoot 'run-sidecar.cmd') (((Get-SidecarLauncherLines $Layout $Development) -join "`r`n") + "`r`n")
  $mcp = @('@echo off', "`"$($Layout.Node)`" --no-sparkplug `"$($Layout.Stdio)`" %*")
  Write-TextFile (Join-Path $BinRoot 'extynt-mcp.cmd') (($mcp -join "`r`n") + "`r`n")
  Write-Host "Wrote $BinRoot\run-sidecar.cmd and $BinRoot\extynt-mcp.cmd."
}

# Model settings for the in-panel agent: created once, never overwritten, readable only by this user.
function Install-LlmEnvironment {
  $path = Join-Path $StateRoot 'llm.env'
  if (Test-Path $path) { return }
  $text = "# extynt in-panel agent. Easiest: set the model in the panel under Diagnostics > Model.`r`n# AE_LLM_PROVIDER=deepseek`r`n# DEEPSEEK_API_KEY=`r`n"
  Write-TextFile $path $text
  Invoke-Required 'icacls.exe' @($path, '/inheritance:r', '/grant:r', "$($env:USERNAME):(R,W)") 'restricting llm.env to this user'
}

function ConvertTo-XmlText([string]$Text) {
  return [Security.SecurityElement]::Escape($Text)
}

# The task runs cmd.exe on the launcher inside a headless conhost (no window). cmd.exe is named explicitly: conhost
# starts the program it is given, and a .cmd file is not a program.
function New-TaskXml {
  $user = ConvertTo-XmlText ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $script = ConvertTo-XmlText (Join-Path $BinRoot 'run-sidecar.cmd')
  $arguments = "--headless cmd.exe /d /c `"`"$script`"`""
  return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Starts the extynt sidecar at logon; run-sidecar.cmd keeps it running.</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>conhost.exe</Command><Arguments>$arguments</Arguments></Exec></Actions>
</Task>
"@
}

function Register-SidecarTask {
  $xmlPath = Join-Path $env:TEMP 'extynt-sidecar-task.xml'
  [IO.File]::WriteAllText($xmlPath, (New-TaskXml), [Text.Encoding]::Unicode)
  $result = Invoke-Schtasks @('/Create', '/TN', $TaskName, '/XML', $xmlPath, '/F')
  Remove-Item $xmlPath -Force -ErrorAction SilentlyContinue
  if ($result.Code -ne 0) { Stop-Install "could not register the scheduled task: $($result.Output)" }
  Write-Host "Registered the scheduled task '$TaskName' (at logon, supervised restart, no window)."
}

# The release plugin reads the library only from %PROGRAMDATA%, which a standard user cannot write. A checkout install
# stages the library with install-host-library.ts first. Setup writes both for a bundle itself, as an administrator.
function Install-ReleaseParts($Layout) {
  $hostSource = $Layout.HostSource
  if (-not $Layout.IsBundle) {
    $hostSource = Join-Path $env:TEMP 'extynt-host-stage'
    Remove-Item $hostSource -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-Required $Layout.Node @((Join-Path $Layout.Root 'scripts\install-host-library.ts'), '--dest', $hostSource) 'staging the host library'
    $hostSource = Join-Path $hostSource 'host'
  }
  Write-Host "One elevated step: the plugin and the host library are written by an administrator (UAC prompt)."
  try { $code = Invoke-ElevatedStep 'Install' $hostSource $Layout.PluginSource }
  catch { Stop-Install "the elevated step did not run: $($_.Exception.Message)" }
  if ($code -eq 3) { Write-Warning 'No After Effects 2025 or later found: the plugin was not installed. Install After Effects, then run the installer again.' }
  elseif ($code -ne 0) { Stop-Install "the elevated step failed (exit code $code); see $StateRoot\elevated-step.log." }
  Write-Host "Installed the host library: $ReleaseHostParent\host."
}

function Install-HostLibrary($Layout, [bool]$Development) {
  if ($Layout.IsBundle) {
    Write-Host "Setup installed the plugin and the host library ($ReleaseHostParent\host)."
  } elseif ($Development) {
    Invoke-Required $Layout.Node @((Join-Path $Layout.Root 'scripts\install-host-library.ts'), '--dest', $StateRoot) 'installing the development host library'
    Write-Host "Installed the host library for development builds: $StateRoot\host (no elevation)."
  } else {
    Install-ReleaseParts $Layout
  }
}

# The build id the installed sidecar exports from server-build.js (it hashes the emitted JS).
function Get-ExpectedBuildId($Layout) {
  $contracts = ConvertTo-FileUri (Join-Path (Split-Path $Layout.Main) 'server-build.js')
  return & $Layout.Node --input-type=module -e "import('$contracts').then(m=>process.stdout.write(m.SIDECAR_BUILD_ID))"
}

# Starts the task and proves the listener is the code just installed (the build id hashes the emitted JS).
function Start-AndProveSidecar($Layout) {
  Invoke-Schtasks @('/Run', '/TN', $TaskName) | Out-Null
  $expected = Get-ExpectedBuildId $Layout
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $session = Read-Session
    $health = if ($session) { Invoke-Health $session } else { $null }
    if ($health -and (Get-Property $health 'build') -eq $expected) {
      Write-Host "Health check: ok (sidecar $(Get-Property $health 'version'), build $expected) at http://127.0.0.1:$($session.port)/health"
      return
    }
    Start-Sleep -Seconds 1
  }
  Stop-Install "the new sidecar did not become the active listener; see $StateRoot\sidecar.error.log."
}

# The effect catalogue's window, opened as the signed-in user (this script runs as that user) once the sidecar is proven
# healthy; it learns the installed effects in the background and Setup finishes at once, as the macOS package's postinstall
# opens "extynt Catalogue.app". Without a desktop (a service or remote session) or when it cannot start, the catalogue
# runs when After Effects next starts instead.
function Open-CatalogueWindow($Layout) {
  if (-not $Layout.IsBundle) { return }
  $window = Join-Path $Layout.Root 'catalogue-window\extynt Catalogue.exe'
  try {
    if (-not [Environment]::UserInteractive) { throw 'there is no desktop session' }
    if (-not (Test-Path $window)) { throw "$window is missing" }
    Start-Process -FilePath $window -WorkingDirectory (Split-Path $window) | Out-Null
    Write-Host 'Opened the effect catalogue window.'
  } catch {
    Write-Host 'The effect catalogue window did not open; the catalogue runs when After Effects next starts.'
    Write-Host "  ($($_.Exception.Message))"
  }
}

function Write-NextSteps($Layout) {
  Write-Host 'Installed the extynt sidecar as a per-user scheduled task. It listens on 127.0.0.1 only.'
  Write-Host "Logs: $StateRoot\sidecar.log and $StateRoot\sidecar.error.log"
  $launcher = if ($Layout.IsBundle) { Join-Path $ReleaseHostParent 'bin\extynt-mcp.cmd' } else { Join-Path $BinRoot 'extynt-mcp.cmd' }
  Write-Host "MCP clients: open the extynt panel > Settings > Agents, or point any MCP client at cmd /c $launcher"
  if (-not $Layout.IsBundle) { Write-Host 'Install the plugin if you have not: native\extynt-core\build-win.ps1 -Action Install.' }
  Write-Host 'Restart After Effects and open Window > extynt. Check the installation with verify.ps1 in this folder.'
}

# Records the language Setup ran in for the panel (docs/architecture/ui-languages.md): the file ui-language in this user's
# state folder, first line the code. It runs as the user who started Setup, so it lands in that user's %LOCALAPPDATA%.
# A code the panel does not speak, or none (a developer install), leaves the file as it is.
function Write-UiLanguage([string]$Language) {
  if (@('en', 'es', 'de', 'fr', 'ja', 'zh-Hans') -cnotcontains $Language) { return }
  Write-TextFile (Join-Path $StateRoot 'ui-language') "$Language`n"
}
