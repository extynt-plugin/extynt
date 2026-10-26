# extynt documentation

extynt is a native After Effects plugin (macOS `.plugin`, Windows `.aex`) with a per-user loopback sidecar that serves
the panel and talks to the model. These documents describe the current product. The project overview, build steps and
trademark notices are in the [root README](../README.md).

## Start here

- [Architecture](architecture/README.md): the plugin, the sidecar, the panel, the host library, plan surfaces and the
  install model in one page.
- [Connect an agent](connect-an-agent.md): using extynt from an external MCP client such as Claude Code or Codex.
- [Taste](taste.md): what good code looks like here, with real examples.
- [Coding rules](coding-rules.md): the gate limits and the gate protocol.
- [Contributing](../CONTRIBUTING.md): setup, the manual Adobe SDK, the gate and pull requests.

## Architecture and decisions

- [One path for tools](architecture/panel-mcp.md)
- [Relational state](architecture/relational-state.md)
- [Effect notes](architecture/effect-notes.md)
- [Decisions](decisions/): numbered ADRs, one per lasting choice. The Adobe SDK is [0005](decisions/0005-manual-adobe-sdk-acquisition.md);
  the install and privilege model is [0041](decisions/0041-install-and-privilege-model.md);
  decision models are [0045](decisions/0045-decision-models.md).
- [Permission matrix](permission-matrix.md)
- [Verification and plugin evidence](verification-and-plugin-evidence.md)
- [Inline SVG artwork](inline-svg-artwork.md)
- [Footage interpretation, scene edits and analysis effects](footage-and-analysis.md)

## Native plugin

- [Plugin design](native/plugin-design.md)
- [Wire protocol](native/protocol.md)
- [UI contract](native/ui-contract.md)
- [Windows platform](platforms/windows.md)

## Panel

- [Panel UI principles](design/panel-ui-principles.md)

## Packaging and release

- [macOS packaging](../packaging/macos/README.md) and [signed release](../packaging/macos/release/README.md)
- [Windows packaging](../packaging/windows/README.md)
- [Sidecar](../apps/sidecar/README.md), [panel](../apps/panel/README.md) and [decode](../packages/decode/README.md) / [decide](../packages/decide/README.md) packages
