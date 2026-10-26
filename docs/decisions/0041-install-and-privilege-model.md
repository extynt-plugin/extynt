# ADR 0041: per-user install with one elevated host-library step

Status: accepted

## Context

extynt runs three pieces on the user's machine: the native plugin inside After
Effects, a loopback sidecar that serves the panel UI and the agent runtime, and
the UI itself. The plugin runs jsx through `AEGP_ExecuteScript`. Whatever script
text reaches that call runs inside After Effects with the user's full access to
the project and the file system, so the question is who can influence it.

A user-writable script folder would let any process running as that user change
the code After Effects executes. A fully elevated install would give an
installer, a sidecar and a model-driven agent far more reach than they need.

## Decision

1. The sidecar, its served UI, its profile and its session file are installed
   and run per user, with no administrator access. macOS runs the sidecar as a
   `launchd` LaunchAgent (`com.extynt.sidecar`); Windows runs it as a scheduled
   task registered at logon with `LeastPrivilege`. Per-user state is
   `~/Library/Application Support/extynt` on macOS and `%LOCALAPPDATA%\extynt`
   on Windows.
2. The host library (`apps/panel/host/*.jsx` and `manifest.json`) is the only
   script text the plugin runs. A release plugin build reads it only from a
   directory a standard user cannot write:
   - macOS: `/Library/Application Support/extynt/host`, owned by root, placed by
     one sudo step in `packaging/macos/install.sh`. The installer prints each
     command it runs with sudo and uses sudo for nothing else.
   - Windows: `%PROGRAMDATA%\extynt\host`, written by one elevated (UAC) step in
     `packaging/windows/install.ps1`, with write access limited to
     administrators and SYSTEM.
   A development library build also reads a per-user directory; it is a separate
   plugin build and never the release default (`--dev-library` on macOS,
   `-DevLibrary` on Windows).
3. The sidecar listens on `127.0.0.1` only. Its bearer token is generated per
   sidecar start and written with the bound port to a per-user session file
   (`session.json`, mode `0600`). The unauthenticated `GET /v1/pair` answers only
   whether a sidecar is listening and on which port.
4. No caller supplies script text. The plugin builds every script from fixed
   text for one allowlisted library entry point; request arguments reach it only
   as an escaped string literal. A model or an MCP client can ask for a typed
   operation, never for code.
5. Placing the plugin into After Effects' own `Plug-ins` folder is a separate
   build-script step that writes a folder owned by root or administrators and
   asks for elevation itself (`native/extynt-core/build-mac.sh --install`,
   `build-win.ps1 -Action Install`).

## Consequences

- Nothing running as the user can change the scripts After Effects executes
  without elevation. Compromising the user account does not by itself yield
  code execution inside After Effects through the library.
- The installer prompts for elevation once for the library, so an update of the
  library needs that step again.
- Anything that can run as the same user can read the session file and call the
  sidecar; the token separates the sidecar from other users and from web pages,
  not from the user's own processes.
- Because the sidecar is per user, a shared machine runs one sidecar per
  account, each with its own port, token and profile.
- Adding a new host operation means adding a library entry point and shipping a
  new library, not sending new script text at runtime.
