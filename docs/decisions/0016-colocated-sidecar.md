# ADR 0016: per-user loopback sidecar next to After Effects

Status: accepted

## Context

extynt needs a local runtime beside After Effects: it serves the panel UI, holds
the agent runtime, plan and workflow stores, and the model connection, and it is
the endpoint external MCP clients talk to. That runtime must start without
manual setup, restart after a crash, need no administrator access, and not
require the user to copy an endpoint or token between tools.

## Decision

The sidecar (`apps/sidecar`) runs on the same machine as After Effects, as a
per-user background service bound to `127.0.0.1`:

- macOS: a `launchd` LaunchAgent (`com.extynt.sidecar`) in the user's
  `gui/<uid>` domain, started at login and restarted after a non-zero exit
  (`RunAtLoad`, `KeepAlive` with `SuccessfulExit` false). A host-close request is
  an intentional exit and stays down. Installed and removed with
  `launchctl bootstrap` and `bootout` without administrator access.
- Windows: a scheduled task registered at logon with `LeastPrivilege`, restarted
  on failure, running without a window.

The sidecar binds an ephemeral port and generates a bearer token at start. It
writes both to a per-user `session.json` with `0600` permissions
(`packages/mcp-server/src/session.ts`; `~/Library/Application
Support/extynt/session.json` on macOS, `%LOCALAPPDATA%\extynt\session.json` on
Windows). That file is how the endpoint and token are distributed:

- the native plugin reads it to open the panel page at
  `http://127.0.0.1:<port>/ui/` and hands the token to that page;
- the local MCP launcher (`packages/mcp-server/src/stdio.ts`) reads it when
  `AE_BRIDGE_TOKEN` and `EXTYNT_ENDPOINT` are not set, so a Claude Code or Codex
  configuration needs no secret of its own.

`GET /v1/pair` answers only whether a sidecar is listening and on which port. It
never returns the token. Every state-changing route requires the bearer token,
and a route that is not loopback is refused.

Packaging ships the sidecar with its own Node.js runtime, so no global Node
installation is needed. Installation and privileges are described in
[ADR 0041](0041-install-and-privilege-model.md).

## Consequences

- Normal use needs no tunnel, remote host or pasted credentials.
- The trust boundary is loopback plus per-user file permissions. Anything
  running as the same user can read the session file; other users and web pages
  cannot obtain the token.
- A shared machine runs one sidecar per account, each with its own port, token
  and profile.
- `AE_BRIDGE_PORT`, `AE_BRIDGE_TOKEN` and `EXTYNT_ENDPOINT` override the defaults
  for development and tests.

## Revisit triggers

Revisit if a multi-user deployment sharing one sidecar is required, since the
loopback trust assumption would no longer hold, or if the platform service
managers change how per-user background services are registered.
