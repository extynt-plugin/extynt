# extynt: macOS bundle

extynt is an LLM-agnostic runtime for controlling creative applications. Its After
Effects panel is the native plugin (`extyntcore.plugin`), which loads its page from
the local sidecar. This bundle is the sidecar, the page it serves, and the host script
library the plugin runs. The plugin is built and installed separately
(`native/extynt-core/build-mac.sh --install`).

## Contents

| Folder | What |
| --- | --- |
| `sidecar/`, `runtime/`, `sidecar-launchd/` | the sidecar, its Node.js runtime and the launchd agent |
| `ui/` | the served UI: exactly the files in `ui-manifest.json` |
| `host/` | the host jsx library (`probe.jsx`, its parts, `manifest.json` with the version) |

## Build

`scripts/build-mac-bundle.sh` (Linux or Mac) builds the transfer bundle,
`artifacts/extynt-<version>-macos[-arch].tar.gz`. `EXTYNT_ARCH=x64|universal` selects the
other architectures (arm64 is the default). The bundle carries the Node.js runtime as
published by nodejs.org, so installing needs no Node.js on the Mac.

## Install

Extract the archive on the Mac and run:

```sh
./install.sh
./verify.sh
```

`install.sh`:

1. Installs the bundled Node.js runtime, the sidecar and the served UI under
   `~/Library/Application Support/extynt/`, and registers the per-user `launchd`
   agent (the plist sets `EXTYNT_UI_DIRECTORY`). No administrator access.
2. Installs the host library to `/Library/Application Support/extynt/host/`, owned by
   root, because a release plugin build reads only there. This is the single `sudo`
   step; the installer says why before running it.

`./install.sh --system-only` and `--user-only` are the two halves the package runs (root and
console user). `./install.sh --dev-library` installs the host library to
`~/Library/Application Support/extynt/host/` instead, with no `sudo`, for a plugin
built with `build-mac.sh --dev-library`.

To use the in-panel agent, pick a provider and enter its key under Settings > Provider & keys
in the panel, or edit `~/Library/Application Support/extynt/llm.env` (created by the
installer): set `AE_LLM_PROVIDER` to your provider and that provider's API key, then
restart the sidecar:

```sh
launchctl kickstart -k gui/$(id -u)/com.extynt.sidecar
```

Restart After Effects, then open **Window > extynt**. Also restart Claude Desktop or
your MCP client: it keeps running the previous extynt MCP server until it is restarted
(the installer never stops it for you, and `ae_status` reports the mismatch). The panel
pairs and refreshes the project automatically. Type what you want; changes come back as
a plan card with Apply. See [`docs/connect-an-agent.md`](../../docs/connect-an-agent.md) to
connect Claude or Codex to the same sidecar.

The plugin starts the sidecar (`launchctl kickstart`) when After Effects launches. When
After Effects quits the sidecar stays up and reports `HOST_OFFLINE`; a crash or non-zero
exit is restarted by launchd. The manual `launchctl kickstart` command above is the
recovery path.

## Signed package

End users get a signed, notarized `extynt-<version>.pkg` instead of the tarball, built on a
Mac with the signing material in its keychain by one command (it needs your own signing identities; only `--dry-run` works without them):

```sh
AE_SDK_ROOT=<sdk> packaging/macos/release/make-release.sh        # --no-notarize for a local test
```

It builds the release bundle (the sidecar, pinned Node.js), builds and
signs the plugin (Developer ID Application, hardened runtime, timestamp), packages
everything for the system domain, signs the package (Developer ID Installer), notarizes it
with the keychain profile `extynt-notary` and staples it.

The package asks for one administrator password. As root, its postinstall runs
`install.sh --system-only` (the root-owned host library, the
plugin in After Effects 2025 and 2026); then, as the console user, `install.sh --user-only`
(sidecar, runtime, launcher, login service). It logs to
`~/Library/Application Support/extynt/installer.log`. Certificates, App Store Connect keys
(`.p8`, `.p12`) and their passwords never go into the repository, a report or a bundle.
Details and one-time setup: [`release/README.md`](release/README.md).

## Removal

```sh
./uninstall.sh        # a package install links it at "/Library/Application Support/extynt/uninstall.sh"
```

This stops and removes the sidecar launchd agent, the served UI, both host libraries, the
plugin in every After Effects, the installer payload and the package receipt (the
root-owned parts with `sudo`).
Your chats and settings in `~/Library/Application Support/extynt` are kept.

## Third-party notices

`NOTICE` and `licenses/` (xxHash, AEQuery, Node.js) sit at the bundle root and are installed beside the sidecar
in `~/Library/Application Support/extynt`. The build fails if any of them is missing; `NOTICE` names exactly those files.

## Trademarks

Adobe and After Effects are either registered trademarks or trademarks of Adobe Inc. in the United States and/or other countries. extynt is an independent product and is not affiliated with, endorsed by, or sponsored by Adobe Inc.
