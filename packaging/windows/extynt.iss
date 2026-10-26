; extynt for Windows: the installer script. How it is built, signed and what Setup does: packaging\windows\README.md.
;
;   iscc /DBundleDir="<repo>\artifacts\win-bundle\extynt-<version>-win-x64" packaging\windows\extynt.iss
;
; Needs Inno Setup 6.7 or newer (dynamic light and dark). BundleDir comes from scripts/build-win-bundle.ts, which prints
; the exact command. Output: artifacts\win-installer\extynt-<version>-setup.exe (override with /DOutputDir=...).
; Signing: add /DSignToolName=extynt-sign and /Sextynt-sign="bash scripts/sign-win.sh $f" to sign the setup and uninstaller.
; The wizard images are rendered from branding\wizard.html by scripts\render-wizard-images.ts (100, 150 and 200% scale).

#ifndef BundleDir
  #error Pass /DBundleDir=<staged bundle directory> (see scripts/build-win-bundle.ts).
#endif
#ifndef OutputDir
  #define OutputDir "..\..\artifacts\win-installer"
#endif
#define VersionFile FileOpen(AddBackslash(BundleDir) + "VERSION")
#define AppVersion Trim(FileRead(VersionFile))
#expr FileClose(VersionFile)
#define FileVersionFile FileOpen(AddBackslash(BundleDir) + "FILE_VERSION")
#define AppFileVersion Trim(FileRead(FileVersionFile))
#expr FileClose(FileVersionFile)

[Setup]
AppId={{6F0B7C1E-3D52-4B8A-9E64-1A2C5D8F7B90}
AppName=extynt
AppVersion={#AppVersion}
AppVerName=extynt {#AppVersion}
AppPublisher=extynt
AppPublisherURL=https://extynt.com
AppSupportURL=https://extynt.com
AppComments=extynt AI tools. The first one is for Adobe After Effects.
VersionInfoCompany=extynt
VersionInfoProductName=extynt
VersionInfoDescription=extynt AI tools Setup
VersionInfoVersion={#AppFileVersion}
VersionInfoProductTextVersion={#AppVersion}
DefaultDirName={autopf}\extynt
DisableWelcomePage=no
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
UsedUserAreasWarning=no
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=extynt-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern dynamic
WizardBackColor=$ecf2f4
WizardBackColorDynamicDark=$151515
SetupIconFile=branding\extynt.ico
WizardImageFile=branding\wizard-164.bmp,branding\wizard-246.bmp,branding\wizard-328.bmp
WizardImageFileDynamicDark=branding\wizard-dark-164.bmp,branding\wizard-dark-246.bmp,branding\wizard-dark-328.bmp
WizardSmallImageFile=branding\wizard-small-55.bmp,branding\wizard-small-83.bmp,branding\wizard-small-110.bmp
WizardSmallImageFileDynamicDark=branding\wizard-small-dark-55.bmp,branding\wizard-small-dark-83.bmp,branding\wizard-small-dark-110.bmp
UninstallDisplayName=extynt AI tools {#AppVersion}
UninstallDisplayIcon={app}\extynt.ico
CloseApplications=no
ShowLanguageDialog=auto
LanguageDetectionMethod=uilanguage
#ifdef SignToolName
SignTool={#SignToolName}
SignedUninstaller=yes
#endif

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl,languages\extynt.en.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl,languages\extynt.es.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl,languages\extynt.de.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl,languages\extynt.fr.isl"
Name: "ja"; MessagesFile: "compiler:Languages\Japanese.isl,languages\extynt.ja.isl"
Name: "zhHans"; MessagesFile: "languages\ChineseSimplified.isl,languages\extynt.zh-Hans.isl"

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "branding\extynt.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BundleDir}\host\*"; DestDir: "{commonappdata}\extynt\host"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
Type: filesandordirs; Name: "{commonappdata}\extynt\host"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{commonappdata}\extynt"

[Code]
const
  PluginFileName = 'extyntcore.aex';
  EnginePidScript = '$p = 0; try { $p = [int](Get-Content -Raw (Join-Path $env:LOCALAPPDATA ''extynt\native-engine.json'') | ConvertFrom-Json).pid } catch { }; ';

var
  InstallStepFailed: Boolean;
  PurgeChosen: Boolean;

function PowerShellPath: String;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

function ScriptParameters(const Script, Arguments: String): String;
begin
  Result := '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" ' + Arguments;
end;

{ The language code the panel reads: the wizard's language, with the Simplified Chinese entry's identifier spelled as the tag. }
function UiLanguageCode: String;
begin
  Result := ActiveLanguage;
  if Result = 'zhHans' then Result := 'zh-Hans';
end;

{ The per-user steps run as the user who started Setup, not as the administrator Setup became. }
function RunScriptAsUser(const Script, Arguments: String; var ExitCode: Integer): Boolean;
begin
  Result := ExecAsOriginalUser(PowerShellPath, ScriptParameters(Script, Arguments), ExpandConstant('{app}'), SW_HIDE,
    ewWaitUntilTerminated, ExitCode);
end;

function RunScript(const Script, Arguments: String; var ExitCode: Integer): Boolean;
begin
  Result := Exec(PowerShellPath, ScriptParameters(Script, Arguments), ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode);
end;

{ After Effects 2025 or later, or a beta (Test-SupportedAfterEffects in common.ps1 is the same rule). }
function IsSupportedAfterEffects(const Name: String): Boolean;
begin
  if Pos('Beta', Name) > 0 then
    Result := True
  else
    Result := StrToIntDef(Copy(Name, Length('Adobe After Effects ') + 1, 4), 0) >= 2025;
end;

{ The extynt folder under Plug-ins of every supported After Effects install. The caller frees the list. }
function PluginFolders: TStringList;
var
  Adobe: String;
  FindRec: TFindRec;
begin
  Result := TStringList.Create;
  Adobe := ExpandConstant('{commonpf64}\Adobe\');
  if FindFirst(Adobe + 'Adobe After Effects*', FindRec) then
  try
    repeat
      if ((FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0) and IsSupportedAfterEffects(FindRec.Name) then
        Result.Add(Adobe + FindRec.Name + '\Support Files\Plug-ins\extynt');
    until not FindNext(FindRec);
  finally
    FindClose(FindRec);
  end;
end;

{ Copies the plugin into every supported After Effects install and proves each copy by hash. Returns the number of installs
  written, or -1 with the copy that failed in Failed. }
function InstallPlugin(var Failed: String): Integer;
var
  Folders: TStringList;
  Source, Target, Expected: String;
  I: Integer;
begin
  Source := ExpandConstant('{app}\plugin\') + PluginFileName;
  Expected := GetSHA256OfFile(Source);
  Folders := PluginFolders;
  try
    Result := Folders.Count;
    for I := 0 to Folders.Count - 1 do
    begin
      Target := Folders[I] + '\' + PluginFileName;
      if (Result >= 0) and not (ForceDirectories(Folders[I]) and CopyFile(Source, Target, False) and (GetSHA256OfFile(Target) = Expected)) then
      begin
        Failed := Target;
        Result := -1;
      end;
    end;
  finally
    Folders.Free;
  end;
end;

procedure RemovePlugin;
var
  Folders: TStringList;
  I: Integer;
begin
  Folders := PluginFolders;
  try
    for I := 0 to Folders.Count - 1 do
      DelTree(Folders[I], True, True, True);
  finally
    Folders.Free;
  end;
end;

{ Administrators and SYSTEM write, users read: a standard user must not be able to replace the library a release plugin trusts. }
function ProtectHostParent: Boolean;
var
  ExitCode: Integer;
  Parent: String;
begin
  Parent := ExpandConstant('{commonappdata}\extynt');
  Result := ForceDirectories(Parent) and Exec(ExpandConstant('{sys}\icacls.exe'), '"' + Parent + '" /inheritance:r /grant:r ' +
    '*S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) and (ExitCode = 0);
end;

{ The catalogue's hidden engine is the AfterFX.exe whose pid the engine's plugin wrote to native-engine.json in the user's
  state folder; it is not the user's After Effects. Any other AfterFX.exe counts, elevated or not: no command line is read. }
function AfterEffectsIsRunning: Boolean;
var
  ExitCode: Integer;
begin
  Result := not (Exec(PowerShellPath, '-NoProfile -ExecutionPolicy Bypass -Command "' + EnginePidScript +
    'if (@(Get-Process -Name AfterFX -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $p }).Count -eq 0) { exit 0 } else { exit 3 }"',
    '', SW_HIDE, ewWaitUntilTerminated, ExitCode) and (ExitCode = 0));
end;

{ Ends the catalogue's window and its hidden engine (by pid, with its children), so the files they hold can be replaced or removed. }
procedure StopCatalogue;
var
  ExitCode: Integer;
  WindowPath: String;
begin
  WindowPath := ExpandConstant('{app}\catalogue-window\extynt Catalogue.exe');
  StringChangeEx(WindowPath, '''', '''''', True);
  Exec(PowerShellPath, '-NoProfile -ExecutionPolicy Bypass -Command "' + EnginePidScript +
    'Get-Process -Id $p -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq ''AfterFX'' } | ' +
    'ForEach-Object { & taskkill.exe /PID $_.Id /T /F | Out-Null }; ' +
    'Get-Process -Name ''extynt Catalogue'' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ''' + WindowPath +
    ''' } | ForEach-Object { Stop-Process -Id $_.Id -Force; $_.WaitForExit(5000) | Out-Null }"', '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if AfterEffectsIsRunning then
  begin
    SuppressibleMsgBox(CustomMessage('AfterEffectsRunningSetup'), mbError, MB_OK, IDOK);
    Result := False;
  end;
end;

{ The plugin file and the host library are in use while After Effects runs, so an uninstall waits for it to close. }
function InitializeUninstall: Boolean;
begin
  Result := True;
  if AfterEffectsIsRunning then
  begin
    SuppressibleMsgBox(CustomMessage('AfterEffectsRunningUninstall'), mbError, MB_OK, IDOK);
    Result := False;
  end
  else
    StopCatalogue;
end;

{ An update replaces node.exe, which Windows will not do while it runs. Ending the task leaves its node.exe running, and an
  MCP client may have started one too, so every process running this install's node.exe is ended as well. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  NodePath: String;
begin
  Exec(PowerShellPath, '-NoProfile -ExecutionPolicy Bypass -Command "Get-ScheduledTask -TaskName ''extynt sidecar*'' ' +
    '-ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue"', '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
  NodePath := ExpandConstant('{app}\runtime\node.exe');
  StringChangeEx(NodePath, '''', '''''', True);
  Exec(PowerShellPath, '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Name node -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.Path -eq ''' + NodePath + ''' } | ForEach-Object { Stop-Process -Id $_.Id -Force; $_.WaitForExit(5000) | Out-Null }"',
    '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
  StopCatalogue;
  if ProtectHostParent then
    Result := ''
  else
    Result := FmtMessage(CustomMessage('ProtectFailed'), [ExpandConstant('{commonappdata}\extynt')]);
end;

{ The launcher MCP clients start, in a folder with no spaces: an agent runs "cmd /c %ProgramData%\extynt\bin\extynt-mcp.cmd",
  and cmd cannot start a path with spaces from there (a Windows user name with a space breaks %LOCALAPPDATA%). }
function WriteMcpLauncher: Boolean;
var
  Folder: String;
begin
  Folder := ExpandConstant('{commonappdata}\extynt\bin');
  Result := ForceDirectories(Folder) and SaveStringToFile(Folder + '\extynt-mcp.cmd',
    '@echo off' + #13#10 + '"' + ExpandConstant('{app}\runtime\node.exe') + '" --no-sparkplug "' +
    ExpandConstant('{app}\sidecar\node_modules\@extynt\mcp-server\dist\src\stdio.js') + '" %*' + #13#10, False);
end;

procedure FailStep(const Message: String);
begin
  InstallStepFailed := True;
  SuppressibleMsgBox(Message, mbError, MB_OK, IDOK);
end;

{ Writes the plugin and the MCP launcher; false when one failed (already reported). }
function InstallFiles: Boolean;
var
  Installs: Integer;
  Failed: String;
begin
  Installs := InstallPlugin(Failed);
  Result := Installs >= 0;
  if not Result then
    FailStep(FmtMessage(CustomMessage('WriteFailed'), [Failed]))
  else if not WriteMcpLauncher then
  begin
    Result := False;
    FailStep(FmtMessage(CustomMessage('WriteFailed'), [ExpandConstant('{commonappdata}\extynt\bin\extynt-mcp.cmd')]));
  end
  else if Installs = 0 then
    SuppressibleMsgBox(CustomMessage('NoAfterEffects'), mbInformation, MB_OK, IDOK);
end;

procedure RunUserSteps;
var
  ExitCode: Integer;
begin
  if not (RunScriptAsUser(ExpandConstant('{app}\installer\install.ps1'), '-BundleRoot "' + ExpandConstant('{app}') + '" -UiLanguage ' + UiLanguageCode, ExitCode) and (ExitCode = 0)) then
    FailStep(FmtMessage(CustomMessage('InstallFailed'), [IntToStr(ExitCode), ExpandConstant('{localappdata}\extynt\install.log')]));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and InstallFiles then RunUserSteps;
end;

var
  FinishedEyebrow, FinishedDetails: TNewStaticText;

{ A small mono-spaced label above a heading: the eyebrow the macOS installer's welcome and conclusion pages set there. }
function AddEyebrow(Page: TWinControl; Above: TNewStaticText; const Text: String; Color: TColor): TNewStaticText;
begin
  Result := TNewStaticText.Create(WizardForm);
  Result.Parent := Page;
  Result.AutoSize := True;
  Result.Left := Above.Left;
  Result.Top := Above.Top;
  Result.Font.Name := 'Cascadia Mono';
  Result.Font.Size := 8;
  Result.Font.Color := Color;
  Result.Caption := Text;
  Above.Top := Above.Top + ScaleY(18);
end;

{ The two big headings are set like extynt.com's: semibold; each is preceded by the macOS installer's eyebrow. }
procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel1.Font.Name := 'Segoe UI Semibold';
  WizardForm.FinishedHeadingLabel.Font.Name := 'Segoe UI Semibold';
  AddEyebrow(WizardForm.WelcomePage, WizardForm.WelcomeLabel1, CustomMessage('WelcomeEyebrow'), $7f878a);
  WizardForm.WelcomeLabel2.Top := WizardForm.WelcomeLabel2.Top + ScaleY(18);
  WizardForm.WelcomeLabel2.Height := WizardForm.WelcomePage.ClientHeight - WizardForm.WelcomeLabel2.Top;
  FinishedEyebrow := AddEyebrow(WizardForm.FinishedPage, WizardForm.FinishedHeadingLabel, CustomMessage('FinishedEyebrow'), $639a3f);
  WizardForm.FinishedLabel.Top := WizardForm.FinishedLabel.Top + ScaleY(18);

  FinishedDetails := TNewStaticText.Create(WizardForm);
  FinishedDetails.Parent := WizardForm.FinishedPage;
  FinishedDetails.AutoSize := False;
  FinishedDetails.WordWrap := True;
  FinishedDetails.Left := WizardForm.FinishedLabel.Left;
  FinishedDetails.Width := WizardForm.FinishedLabel.Width;
  FinishedDetails.Height := ScaleY(48);
  FinishedDetails.Font.Size := 8;
  FinishedDetails.Font.Color := $7f878a;
end;

{ A failed install step was already explained in its own message: the last page says so too instead of "finished". The install
  folder is only known once it is chosen, so the details are written when the last page shows. }
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    FinishedDetails.Caption := FmtMessage(CustomMessage('FinishedDetails'), [ExpandConstant('{app}\unins000.exe')]);
    FinishedDetails.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(14);
    FinishedEyebrow.Visible := not InstallStepFailed;
    FinishedDetails.Visible := not InstallStepFailed;
  end;
  if (CurPageID = wpFinished) and InstallStepFailed then
  begin
    WizardForm.FinishedHeadingLabel.Caption := CustomMessage('NotReadyHeading');
    WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('NotReadyBody'), [ExpandConstant('{localappdata}\extynt\install.log')]);
  end;
end;

{ Silent and scripted installs see the failure as exit code 1. }
function GetCustomSetupExitCode: Integer;
begin
  if InstallStepFailed then Result := 1 else Result := 0;
end;

{ Ask whether to also delete settings, chat history, the model API key and logs. Silent uninstalls keep them unless /PURGE=1 is passed. }
function WantsPurge: Boolean;
begin
  if UninstallSilent then
    Result := ExpandConstant('{param:PURGE|0}') = '1'
  else
    Result := MsgBox(CustomMessage('PurgeQuestion'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
end;

{ At usUninstall the purge is asked and uninstall.ps1 runs; PurgeChosen then lets usPostUninstall remove whatever uninstall.ps1 could
  not delete while the uninstall still ran, so no empty folder stays behind. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ExitCode: Integer;
  Arguments: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    Arguments := '';
    PurgeChosen := WantsPurge;
    if PurgeChosen then Arguments := '-Purge';
    if not RunScript(ExpandConstant('{app}\installer\uninstall.ps1'), Arguments, ExitCode) or (ExitCode <> 0) then
      SuppressibleMsgBox(FmtMessage(CustomMessage('UninstallPartsFailed'), [IntToStr(ExitCode), ExpandConstant('{app}')]), mbError, MB_OK, IDOK);
    RemovePlugin;
  end;
  if CurUninstallStep = usPostUninstall then
    if PurgeChosen then DelTree(ExpandConstant('{localappdata}\extynt'), True, True, True)
    else RemoveDir(ExpandConstant('{localappdata}\extynt'));
end;
