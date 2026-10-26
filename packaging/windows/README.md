# extynt on Windows: packaging and installation

Two ways to install, with the same scripts underneath:

- **The release installer**, `extynt-<version>-setup.exe` (Inno Setup, x64 only). Bundles its own Node runtime and a
  release build of the sidecar. This is what the prebuilt download contains.
- **A developer install** from a built checkout (`install.ps1`), for working on the product.

The Windows build has had less real-hardware testing than the macOS build.

## What gets installed where

| Piece | Location |
| --- | --- |
| Installed bundle (node.exe, sidecar, scripts, plugin copy) | `C:\Program Files\extynt` (installer only) |
| Plugin | `C:\Program Files\Adobe\Adobe After Effects <year>\Support Files\Plug-ins\extynt\extyntcore.aex`, every After Effects 2025 or later |
| Host jsx library | `%PROGRAMDATA%\extynt\host` (release; administrators write it, users read) or `%LOCALAPPDATA%\extynt\host` (`-DevLibrary`) |
| State (session.json, native.json, llm.env, logs, WebView2 profile, install.log) | `%LOCALAPPDATA%\extynt` |
| Served panel UI | `%LOCALAPPDATA%\extynt\ui` (exactly the files `ui-manifest.json` lists) |
| Launchers | `%LOCALAPPDATA%\extynt\bin\run-sidecar.cmd`, `extynt-mcp.cmd` |
| Autostart | per-account Scheduled Task `extynt sidecar <account>` (one for each Windows account that runs the installer) |

Setup asks for administrator rights once, when it starts, as every After Effects plugin installer does: the plugin goes
into After Effects' own folder under Program Files. The UAC prompt names extynt Setup and the signer. The task, launchers,
UI and settings are per user.

## Building the release installer

Order matters because the plugin is built with MSVC on Windows and everything else can be built anywhere.

1. **Windows**: build the plugin, `native\extynt-core\build-win.ps1 -AeSdkRoot <SDK>`. The product is
   `native\extynt-core\build\win\x64\ae\Release\extyntcore.aex`. Copy it to the machine that builds the bundle, or build the
   bundle on Windows too.
2. **Linux, macOS or Windows** (Node 26.12.1+, pnpm): `node scripts/build-win-bundle.ts <path to extyntcore.aex>`.
   It rebuilds the sidecar and panel from scratch, downloads the Node
   zip pinned in `node-runtime.env` and verifies its SHA-256, and stages the bundle under
   `artifacts/win-bundle/extynt-<version>-win-x64/`. `pnpm check` and `pnpm test` leave `dist/` as a development
   build, so do not use `--no-build` after them. Bump Node by changing `NODE_VERSION` in both `node-runtime.env` files and
   the hash here from `https://nodejs.org/dist/v<version>/SHASUMS256.txt`.
   `NOTICE` and `licenses/` (xxHash, AEQuery, Node.js) are staged beside `installer\`; the build fails if one is missing.
3. **Windows**, Inno Setup 6.7 or newer (dynamic light and dark): `iscc /DBundleDir="<the staged bundle>" packaging\windows\extynt.iss`. The output
   is `artifacts\win-installer\extynt-<version>-setup.exe`. (Wine can run `ISCC.exe` if no Windows machine is at hand;
   this has not been tried.)
4. **Sign** (see below), then install and run `verify.ps1` on a clean Windows machine.

## Signing

`scripts/sign-win.sh <file>...` signs with Microsoft Artifact Signing through jsign. The key never leaves Azure: the script
only holds a short-lived token from `az`. Sign the plugin and the catalogue window **before** step 2
(`scripts/sign-win.sh extyntcore.aex "extynt Catalogue.exe"`, so the signed files go into the bundle; the window opens at
the end of every install) and the setup exe after step 3. To also sign the uninstaller that Setup embeds, let
the compiler call the script per file:
`iscc /DSignToolName=extynt-sign /Sextynt-sign="bash scripts/sign-win.sh $f" /DBundleDir=... packaging\windows\extynt.iss`.
That also signs the setup exe, so signing the finished exe afterwards is unnecessary. Signing the finished exe afterwards does not cover the uninstaller: Inno embeds it compressed, and only the compiler
can sign it before embedding, so a setup signed after the fact leaves `unins000.exe` unsigned (an unknown-publisher UAC prompt on uninstall).
The compiler is `ISCC.exe`, so this needs Windows or Wine; there is no Linux-only way to sign the embedded uninstaller. On a Windows machine
without az or Git Bash, set `EXTYNT_SIGN_TOKEN` (`az account get-access-token --resource
https://codesigning.azure.net --query accessToken -o tsv`, run elsewhere) in the environment of that one `iscc` run only, never
in a file, and give `/S` a wrapper that runs `java -jar jsign.jar --storetype TRUSTEDSIGNING --keystore <endpoint>
--storepass env:EXTYNT_SIGN_TOKEN --alias <account>/<profile> --alg SHA-256 --tsaurl http://timestamp.acs.microsoft.com
--tsmode RFC3161 --replace %1` (a portable JRE 11+ and the jsign jar). `scripts/sign-win.sh` itself also skips `az` when
`EXTYNT_SIGN_TOKEN` is set.

Prerequisites: `az login` as an identity with the Artifact Signing Certificate Profile Signer role, and jsign 5+ with
Java 11+. Signing is optional and driven by the environment; no account is built in. Set `EXTYNT_SIGN_ACCOUNT` (your
Artifact Signing account), `EXTYNT_SIGN_PROFILE` (your certificate profile) and `EXTYNT_SIGN_ENDPOINT` (the account's
regional endpoint host, which must match its region); `EXTYNT_SIGN_TIMESTAMP` is optional (default
`http://timestamp.acs.microsoft.com`). The publisher Windows shows is the certificate's subject; nothing in the installer
names a signer. The PowerShell scripts in the bundle
run through `-ExecutionPolicy Bypass` from the installer and are not signed.

## What the installer does

1. Runs as an administrator (one UAC prompt, at start). Refuses to start while After Effects runs (the plugin file is
   locked), ends a running `extynt sidecar <account>` task and every process running the installed `node.exe` so an update can
   replace it, and restricts `%PROGRAMDATA%\extynt` to administrators (users read).
2. Copies the bundle to `C:\Program Files\extynt`, the host library to `%PROGRAMDATA%\extynt\host` and the plugin into
   every After Effects 2025 or later, checking each copy's SHA-256.
3. Runs `installer\install.ps1 -BundleRoot` hidden, as the user who started Setup, which writes the served UI and
   launchers, creates `llm.env` (once, readable only by the user), registers the scheduled task, starts it and proves
   `/health` reports the build just installed. The transcript is `%LOCALAPPDATA%\extynt\install.log`.
4. If no After Effects 2025 or later is found, everything else is installed and a message says to run the installer again
   after installing it.
5. Learns the installed effects, as the macOS package does: once the sidecar is healthy, `install.ps1` opens
   `catalogue-window\extynt Catalogue.exe` (built with the plugin by `build-win.ps1`; the bundle builder requires it, from
   the build folder or `--catalogue-window <exe>`) as the signed-in user and Setup finishes without waiting. The window asks
   the sidecar (`/v1/catalogue/engine`) to start a hidden second After Effects (`AfterFX.exe -m -noui`, with `EXTYNT_ENGINE=1` in its environment; After Effects rewrites the live command line to `AfterFX.exe -m` while it starts, so a process listing shows `-m` alone) and
   shows its progress. If it cannot open, the log says "The effect catalogue window did not open; the catalogue runs when
   After Effects next starts." The "After Effects is running" checks ignore the hidden engine; an update or uninstall ends
   it and the window.
6. The uninstaller (Settings > Apps, or `unins000.exe` in the app folder) removes the task, launchers, UI, plugin, the release host
   library and the bundle, and asks whether to also delete settings, chat history, the saved model API key,
   logs and the WebView2 profile (`/PURGE=1` answers yes for a silent uninstall). Without that, a reinstall keeps them.

Details of `extynt.iss` that its own comments no longer carry (the gate allows a header and a doc comment above each routine):

- `%PROGRAMDATA%\extynt` is restricted to administrators and SYSTEM (users read) before anything is copied: a standard user
  must not be able to replace the library a release plugin trusts. The host library is installed there, so it inherits that ACL.
- The per-user steps run as the user who started Setup (`ExecAsOriginalUser`), so `UsedUserAreasWarning` is off and the
  messages name that user's `%LOCALAPPDATA%\extynt\install.log`.
- The MCP launcher is `%PROGRAMDATA%\extynt\bin\extynt-mcp.cmd`, in a folder with no spaces: an agent runs
  `cmd /c %ProgramData%\extynt\bin\extynt-mcp.cmd`, and `cmd` cannot start a path with spaces from there (a Windows user
  name with a space breaks `%LOCALAPPDATA%`).
- The wizard follows the system theme with extynt.com's look: paper and ink, brick red for the turn of the tagline. The images
  under `branding\` are rendered from `branding\wizard.html` by `scripts\render-wizard-images.ts` at 100, 150 and 200% scale.
- The gate measures `extynt.iss` (see `docs/coding-rules.md`): header, comments, file length and every `[Code]` routine.

## Developer install

1. Install Node.js 26 (the LTS line from late October 2026; 26.12.1 or newer), pnpm, Visual Studio 2022 (Desktop development with C++), CMake and the WebView2 Evergreen runtime.
2. In the checkout: `pnpm install --frozen-lockfile`, `node scripts\build-panel.ts`, `pnpm -w exec tsc -b`.
3. Plugin: `native\extynt-core\build-win.ps1 -AeSdkRoot <SDK> -Action Install` from an elevated PowerShell (add
   `-DevLibrary` for a development plugin).
4. `packaging\windows\install.ps1` (add `-DevLibrary` to match step 3). `-DevLibrary` also writes
   `NODE_ENV=development` into `run-sidecar.cmd`. The sidecar runs in place from `<checkout>\apps\sidecar\dist`: after moving the
   checkout, run `install.ps1` again, because the task and launchers point at the old path.
5. Restart After Effects and open Window > extynt. `packaging\windows\verify.ps1` checks the installation.
6. Pick a provider and enter its key under Settings > Provider & keys, or edit `%LOCALAPPDATA%\extynt\llm.env`.

If PowerShell refuses to run the scripts, start them with `powershell -ExecutionPolicy Bypass -File <script>`.

`uninstall.ps1 [-System] [-Purge]`: without switches it removes the task, launchers and served UI. `-System` also
removes the plugin and `%PROGRAMDATA%\extynt` (one UAC prompt). `-Purge` also deletes the rest of `%LOCALAPPDATA%\extynt`.

## Why a Scheduled Task

A per-user task needs no administrator rights and runs in the user's own session, where the sidecar reads `llm.env` and
writes `session.json`. A Windows service would run in session 0 and need the user's password. The task has an at-logon
trigger, `IgnoreNew` for multiple instances and no time limit. Its restart-on-failure setting covers only a task that
fails to launch: a sidecar that exits or is killed leaves the task finished (the headless conhost even reports 0). So
`run-sidecar.cmd` sets the environment, rotates the logs and starts `windows-supervisor-main.js`
(`apps\sidecar\dist\src`), which supervises Node: a non-zero exit (a crash or a kill) restarts it after 2, 4, 8, then
every 16 s, and a note goes to `sidecar.error.log`. The wait is a timer inside the supervisor, not a `ping` or `timeout`
process, so a session that has lost its console cannot turn it into a spin. A run of 60 s resets the back-off and the
failure count; the seventh failure in a row (for example Node failing to start with 0xC0000142) logs one line and ends the
task with exit code 1 instead of looping. Exit 0 (a clean shutdown) also ends the task. The task keeps running while Node
is down, so `IgnoreNew` stops the plugin's `schtasks /Run` (or a second logon) from starting another copy. The plugin also
brings the sidecar back when its link drops while After Effects runs: it runs the task again after 2 s, then every 10, 20
and 30 s, at most 6 times per outage (`transport/sidecar_watch.h`).

`schtasks /End` does not reliably end the cmd and Node tree the headless conhost started. So every `/End` we issue (the
installer, the uninstaller, `scripts/stop-local-sidecar.ts`) first writes `%LOCALAPPDATA%\extynt\supervisor.stop`. A
supervisor that started before that file's modification time restarts nothing more and exits 0; one started afterwards
ignores it, so the marker is never deleted and a fresh start needs no cleanup. A manual `schtasks /End` writes no marker:
the supervisor then keeps the sidecar up until it fails, and the failure cap ends it.

The task runs `conhost.exe --headless cmd.exe /d /c "run-sidecar.cmd"`, so no console window appears; the cmd file moves a
log over 5 MB aside to `*.old` when the sidecar starts, then redirects Node's output to `sidecar.log` and
`sidecar.error.log`. `--headless` needs Windows 10 1809 or later. Where it is missing, change the task action to
`wscript.exe //B run-hidden.vbs` with a one-line script that runs the cmd file with window style 0
(`CreateObject("WScript.Shell").Run """<path>\run-sidecar.cmd""", 0, False`). The plugin starts the task at load with
`schtasks.exe /Run /TN "extynt sidecar <account>"`, so a sidecar that is already running is left alone.
