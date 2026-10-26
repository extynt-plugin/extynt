# Windows platform

The native plugin, its sidecar autostart and the installer on Windows, with Mac behaviour unchanged. The Windows build is syntax-checked on Linux by the default gate; building and running it needs Windows with MSVC and After Effects.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| State directory | `%LOCALAPPDATA%\extynt` (session.json, native.json, llm.env, sidecar, ui, logs, WebView2 data) | Holds bearer tokens and a browser profile: it must not roam. macOS keeps `~/Library/Application Support/extynt`. |
| Plugin location | `C:\Program Files\Adobe\Adobe After Effects <year>\Support Files\Plug-ins\extynt\extyntcore.aex` | The MediaCore folder is not searched; Plug-ins is. The plugin is installed for every user; needs elevation, so the installer asks once. Each user runs the installer once from their own account to set up the panel and sidecar. |
| Host jsx library | `%PROGRAMDATA%\extynt\host` (release), `%LOCALAPPDATA%\extynt\host` (dev library build) | The same trust split as macOS: a release build reads only a location a standard user cannot write. |
| Sidecar autostart | Per-user Scheduled Task `extynt sidecar <account>` (one per Windows account, since task names are machine-wide): at-logon trigger, restart on failure, interactive token, least privilege, multiple instances ignored | No service account, no admin for the task itself, restart semantics like launchd KeepAlive. A Windows service would run in session 0 and need a password for the user profile. |
| Hidden console | The task runs `conhost.exe --headless run-sidecar.cmd`; the cmd file starts `windows-supervisor-main.js`, which restarts the sidecar after a crash or kill (timer back-off 2 to 16 s, reset after a 60 s run, gives up after 7 fast failures in a row, ends on exit 0 or on the `supervisor.stop` marker the installer writes before `schtasks /End`) and redirects stdout and stderr to `sidecar.log` and `sidecar.error.log` | No visible window, logs like the plist. Fallback if `--headless` is missing (before Windows 10 1809): `wscript.exe` with a hidden-run launcher, documented in packaging/windows/README.md. |
| Kickstart at load | `schtasks.exe /Run /TN "extynt sidecar <account>"` from the existing `Kickstart` thread (CreateProcessW, no window) | Same shape as `launchctl kickstart` without `-k`: a running sidecar is left alone. |
| Panel | AEGP panel hosting WebView2 in a child window of the AE container HWND | The same page contract as the Mac WKWebView (`docs/native/ui-contract.md`). |
| WebView2 loader | Static loader library from the NuGet SDK (`WebView2LoaderStatic.lib`), runtime from the Evergreen install | No loader DLL next to the .aex. A missing runtime leaves the panel blank (the plugin log carries the reason). |
| Keys | Four layers: (1) AcceleratorKeyPressed classifier and logger (pure classifier in core); (2) host focus forwarding through `MoveFocus`; (3) click-to-focus via `WM_PARENTNOTIFY`; (4) optional `WH_GETMESSAGE` hook that delivers forced keys through CDP `Input.dispatchKeyEvent` and nulls the message | Whether AE takes keys before the page on Windows is not known in advance; the hook is a switch in the flyout so the two behaviours can be compared. |
| Node paths | One `stateDirectory` rule per package, `win32` uses `LOCALAPPDATA` | The macOS rule is unchanged. |
| Signing | Optional. `scripts/sign-win.sh` Authenticode-signs the `.aex` and the setup `.exe` with Microsoft Artifact Signing through jsign. It runs only when `EXTYNT_SIGN_ACCOUNT`, `EXTYNT_SIGN_PROFILE` and `EXTYNT_SIGN_ENDPOINT` are set (`EXTYNT_SIGN_TOKEN` skips `az`); an unsigned local build always works | Signing identities and account names are supplied through the environment and never part of the repository. |

## Mac-only piece to Windows counterpart

| Mac | Windows |
| --- | --- |
| `transport/net_posix.cpp` | `transport/net_win.cpp` (Winsock, `Handle` widens to `intptr_t` there) |
| `defaultDiscoveryPath` under `~/Library` | `%LOCALAPPDATA%\extynt\native.json`, `CreateFileW` + `MoveFileExW`, `BCryptGenRandom` token |
| `getpwuid_r` home | `SHGetKnownFolderPath(FOLDERID_Profile)` |
| `launch_agent.cpp` (launchctl) | child spawn split out: `child_process_posix.cpp`, `child_process_win.cpp`; arguments from a pure function |
| root-owned `/Library/Application Support/extynt/host` | `%PROGRAMDATA%\extynt\host`, ACL checked by the installer |
| `ae_panel_mac.mm` + view, monitor, diag | `ae_panel_win.cpp` (hooks, flyout), `ae_panel_win_view.cpp` (WebView2), `ae_panel_win_keys.cpp`, `ae_panel_win_host.cpp`, `ae_panel_win_load.cpp`, `ae_panel_win_menu.cpp` |
| NSEvent monitor | WebView2 accelerator handler + host window + optional `WH_GETMESSAGE` hook |
| `ae_platform_mac.cpp` (CFBundle version) | `ae_platform_win.cpp` (version resource of the host exe) |
| `rez_pipl.sh` | PiPL pipeline: `cl /EP`, `PiPLTool.exe`, `cl /EP`, resource compiler |
| `build-mac.sh` | `build-win.ps1` |
| `packaging/macos/*.sh` | `packaging/windows/*.ps1` |
| launchd plist | Scheduled Task XML written by `packaging/windows/install-parts.ps1` |

## Gate

* Windows sources are syntax-checked on Linux with mingw-w64 (`WIN_CXX` names the compiler; the default is `x86_64-w64-mingw32-g++-posix`) against the real
  Windows SDK headers and the WebView2 headers fetched by `pnpm setup:tools` (never committed), plus the tiny
  `EventToken.h` shim in `native/extynt-core/tests/syntax-check/win/`. `check-ae-syntax-win.sh` runs inside the `native-core` stage.
* The PowerShell files are held to the same limits by a JS checker (`scripts/lib/ps1-rules.ts`, in the `shell` stage)
  because `pwsh` is not installed here. It is a structural check, not a parser.
* Pure logic added for Windows (key classifier, CDP key parameters, web-error mapping, schtasks arguments,
  document-end wrapper) lives in `core/` or `transport/` and is unit-tested on Linux.
* AEGP hooks with six parameters exceed the parameter limit, so the Windows panel registers them through
  `ae/ae_hook_adapter.h`.

## Known risks

1. Key theft: AE may take Ctrl+A/C/V/X/Z or arrows before the page sees them. Typing in the panel works, but these shortcuts have not been checked specifically. The classifier and hook are a best effort and are the first thing to test.
2. Restart after a crash: killing the sidecar with AE running recovered through the per-account task. A crash right after a reboot is untested.
3. Docked panel redraw: resizing the panel works. Redraw while docked into AE's layout is untested.
4. `PF_AppGetBgColor` exists on Windows but its theme values were never read there.
