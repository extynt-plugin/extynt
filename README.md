# extynt

extynt lets you describe a motion-design change in plain language and have it done inside After Effects. A model proposes a typed plan, extynt validates and previews it, applies it in one undo group, and checks the result against a fresh read of the project.

extynt is a native After Effects plugin (macOS and Windows) with a panel inside After Effects, a small local service that runs the agent, and an MCP connection so Claude Code and Codex can drive the same project. You bring your own model.

The central constraint: a model never manipulates After Effects directly. It proposes typed operations; extynt validates, previews, compiles, executes and verifies them. The same boundary serves the in-panel agent and external agents.

**Status:** 0.1.0, early. macOS and Windows, After Effects 25 and 26. Version 26 is the measured target; 25 is supported but less tested; anything newer than 26 runs as experimental; anything older than 25 is refused. The automated tests run without After Effects; the Windows build has had less real-hardware testing than the macOS build.

## Quick start

**Install a signed build.** Prebuilt, signed installers for macOS and Windows are published on the repository's Releases page. Run the installer, restart After Effects, open **Window > extynt**, then connect a model (below). Building from source gives you the same software.

**Build from source.** You need Node.js 26 (the LTS line from late October 2026; 26.12.1 or newer) and pnpm 10:

```sh
pnpm install
pnpm build
pnpm test
node scripts/check.ts      # the full gate; the same as `pnpm check`
```

These run on Linux, macOS and Windows without After Effects. Installing the plugin into After Effects needs a native build, described under [Building from source](#building-from-source).

**Connect an agent.** Pick a model in the panel's Settings, or let Claude Code or Codex drive After Effects through MCP: see [docs/connect-an-agent.md](docs/connect-an-agent.md).

## Supported versions

| | Supported |
| --- | --- |
| After Effects | 25 and 26. 26 is the measured target; 25 is supported but less tested; newer than 26 runs as experimental; older than 25 is refused. |
| macOS | 13.5 or newer (the minimum Node.js 26 supports) |
| Windows | 10 (version 1809) or 11, x64, with the WebView2 runtime |

## Trademarks and third-party software

extynt is an independent open-source project. It is **not affiliated with, endorsed by, sponsored by or approved by Adobe Inc. or any other company named here.** No Adobe SDK code is included in this repository; you download the After Effects SDK from Adobe yourself.

All product and company names are trademarks or registered trademarks of their respective owners. They are named only to say what extynt works with:

| Name | Owner |
| --- | --- |
| Adobe, After Effects | Adobe Inc. |
| Claude, Claude Code, Anthropic | Anthropic, PBC |
| OpenAI, Codex, GPT | OpenAI, Inc. |
| Gemini, Google | Google LLC |
| DeepSeek | Hangzhou DeepSeek Artificial Intelligence Co., Ltd. |
| xAI, Grok | X.AI Corp. |
| OpenRouter | OpenRouter, Inc. |
| Ollama | Ollama, Inc. |
| Cloudflare, Workers AI, AI Gateway | Cloudflare, Inc. |
| TypeSafe, Jev | TypeSafe AI |
| Windows, WebView2 | Microsoft Corporation |
| macOS, WKWebView | Apple Inc. |
| Node.js | OpenJS Foundation |

Bundled third-party code and its licenses are listed in [NOTICE](NOTICE).

## How it fits together

```text
After Effects ── extynt plugin (native, WebView panel) ── loopback ── sidecar (apps/sidecar) ── your model
   native reads, change events,                              agent loop, plans, receipts,
   host library runs writes                                  MCP tools
                                                                  └── MCP stdio launcher ── Claude Code / Codex
```

- **Plugin** (`native/extynt-core`): an AEGP plugin, a `.plugin` on macOS and an `.aex` on Windows. It hosts the docked panel, reads the project natively and runs the host script library for writes.
- **Panel** (`apps/panel`): the chat UI, served by the sidecar and shown in the plugin's WebView. Plans appear as cards with Apply and Cancel.
- **Sidecar** (`apps/sidecar`): a per-user, loopback-only service. It runs the tool-calling agent, owns plans, the queue, receipts and the read cache, and exposes the MCP tools.
- **Plan surfaces**: the in-panel agent queues work with `ae_queue_*`; external MCP clients use `ae_propose_plan`, `ae_approve_plan` and `ae_plan_*`. See [architecture](docs/architecture/README.md).
- **Network traffic:** the only traffic leaving your machine is to the model provider you configure.

```text
native/extynt-core/            The plugin: pure C++ core, transport, AEGP adapter, tests
apps/panel/                    Panel UI source and bundle; host/ is the host script library the plugin runs
apps/sidecar/                  Local service: agent loop, plans, receipts, native lane, UI server
plugin/                        Claude Code and Codex plugin: MCP launcher config and workflow skill
packages/                      MCP server, LLM adapters, project graph, action plans, workflow engine, capability catalogue
tools/                         Fake plugin, chat-test harness, host verification, native CLI
packaging/                     macOS and Windows installers
docs/                          Architecture, decisions, contributing rules
```

## Building from source

You need Node.js 26 (26.12.1 or newer) and [pnpm](https://pnpm.io) 10. The native plugin additionally needs a C++ toolchain (Xcode command line tools on macOS, Visual Studio with MSVC on Windows) and the Adobe After Effects SDK.

```sh
pnpm install
pnpm setup:tools                  # pinned native and shell tools into .tools/ (needed by the gate's native stages)
pnpm build
pnpm test                         # builds everything and runs all package tests (no After Effects needed)
node scripts/check.ts             # the full gate: lint, types, structure and coding-rule limits
```

**Adobe After Effects SDK.** The SDK is not in this repository and is never redistributed here ([ADR 0005](docs/decisions/0005-manual-adobe-sdk-acquisition.md)). Download it from Adobe's [developer console](https://developer.adobe.com/console/) and unpack it anywhere, for example into `SDKs/` in your checkout (that folder is git-ignored). Then point the build at it:

```sh
export AE_SDK_ROOT=/path/to/AdobeAfterEffectsSDK   # the folder that contains Examples/
pnpm check                                          # also checks the plugin sources that include SDK headers
# without AE_SDK_ROOT, pnpm check skips those SDK-dependent checks and says so
```

**Build and install the plugin.**

- macOS: `native/extynt-core/build-mac.sh --install` (add `--no-sign` for an ad-hoc signature), then `packaging/macos/install.sh`. See [packaging/macos/README.md](packaging/macos/README.md).
- Windows: `native\extynt-core\build-win.ps1 -AeSdkRoot <SDK folder>`, then `packaging\windows\install.ps1`. See [packaging/windows/README.md](packaging/windows/README.md).

Unsigned local builds always work. Signing runs only when you supply your own signing identity through the environment.

**Run the sidecar for development.** `pnpm bridge:start` builds and starts it on `127.0.0.1:3210`.

## Connecting a model

extynt has no model of its own. Pick one of these:

1. **Your own API key.** Anthropic, OpenAI, Google (Gemini), DeepSeek, xAI, OpenRouter, or any OpenAI-compatible or Anthropic-compatible endpoint.
2. **A local model through Ollama.** No key and no data leaves your machine.
3. **Claude Code or Codex through MCP.** The agent drives After Effects through the same typed tools. See [docs/connect-an-agent.md](docs/connect-an-agent.md).

The sidecar reads its settings from, in order of precedence: real environment variables, a `.env` in its working directory (development), then `llm.env` in the per-user state directory (`~/Library/Application Support/extynt/` on macOS, `%LOCALAPPDATA%\extynt\` on Windows). The installer creates a commented `llm.env` template, and the panel's Settings lets you pick a provider and enter its key.

```sh
AE_LLM_PROVIDER=anthropic         # anthropic | openai | google | deepseek | xai | openrouter | ollama | custom | mock
ANTHROPIC_API_KEY=sk-ant-...
# AE_LLM_FALLBACK_PROVIDER=openai # used only when the first model fails to answer or produce a valid plan
```

Copy [`.env.example`](.env.example) to `.env` for local development. Without a provider, chat reports that no model is connected. Before sending anything to a service that may train on prompts, extynt asks you to confirm in the model settings; a local Ollama or other loopback server needs no confirmation. The `mock` provider exercises the plan pipeline offline ("rename to Hero" with a layer selected).

## Optional decision models

Small closed questions (which effect did the request name, is this a drawn scene, is the job finished) are answered by deterministic code by default. If you set `TYPESAFE_API_KEY` (in the same environment, `.env` or `llm.env` as your model settings), the sidecar also asks Jev, a fast decision model by TypeSafe AI, and uses its answer only when it is confident enough; otherwise the deterministic answer stands. Entries in `EXTYNT_DECISION_MODELS` can instead (or also) point at an OpenAI-compatible endpoint, Cloudflare Workers AI or a local server. Jev, OpenAI and Cloudflare are hosted: they receive the request text and the question data of every decision sent to them, so use a local server if that must stay on your machine. Without a configured model nothing changes and no decision data is sent anywhere. The live tests for it skip when the key is missing.

To add a key, use the Decision model section under Model in the panel's Settings (provider, key, Save, Test, Remove), or ask a connected agent to "set up a decision model": it gets a one-time link on your own computer (127.0.0.1, valid for ten minutes, ten tries, used up by one successful save) where you paste the key; the page tests it first and saves it only if the test passes, and on a failure you can fix it and retry. The key is never typed into the chat and never passes through the agent, and it is stored only in `llm.env`, which only you can read, and a saved key is never shown again. If a real environment variable or `.env` already sets the same variable, it wins over `llm.env`; the panel and the page say so after saving. To do it by hand, add `TYPESAFE_API_KEY=...` to `llm.env` (`~/Library/Application Support/extynt/llm.env` on macOS, `%LOCALAPPDATA%\extynt\llm.env` on Windows, `~/.config/extynt/llm.env` on Linux); no restart is needed. See [`packages/decide`](packages/decide/README.md).

## Privacy

- Everything runs on your machine. The sidecar listens on `127.0.0.1` only and authenticates every request with a per-user token.
- Project data goes only to the model provider you configure, and to a decision model only if you configure one (`TYPESAFE_API_KEY` for Jev, or an OpenAI-compatible or Cloudflare Workers AI entry in `EXTYNT_DECISION_MODELS`), which then receives the request text and the question data. With Ollama, nothing leaves your computer.
- There is no account, sign-in, license check, telemetry or update check.
- Chats, plans, receipts and the effect catalogue stay in your per-user state folder. The effect catalogue is collected on your own machine; extynt ships no data about third-party plugins.

## Tests

`pnpm test` runs every package's tests with a fake plugin and synthetic fixtures, so it passes on a clean Linux, macOS or Windows clone with no After Effects. `pnpm check` adds the gate described in [docs/coding-rules.md](docs/coding-rules.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

See the [documentation index](docs/README.md).

## License

MIT. See [LICENSE](LICENSE). Third-party notices are in [NOTICE](NOTICE).
