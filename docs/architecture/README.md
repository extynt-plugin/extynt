# Architecture

extynt is a native After Effects plugin plus a per-user local sidecar. A model proposes typed data; the sidecar validates it; the plugin applies it inside After Effects; the sidecar checks the result against a fresh read. The model never runs script text and never touches After Effects directly.

```text
 panel chat (WebView in AE)                 external MCP client (stdio)
        │  loopback HTTP, /ui/ and routes          │  plugin/bin/extynt-mcp
        ▼                                          ▼
 ┌──────────────────────── sidecar (apps/sidecar, Node, 127.0.0.1 only) ────────────────────┐
 │ chat and agent turn · briefing · plans · queue · receipts · snapshot and read cache       │
 │ decisions (packages/decide) · model providers (packages/llm) · project graph             │
 └───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                             │ loopback TCP, newline-delimited JSON,
                                             │ port and token from native.json
                                             ▼
 ┌──────────────── native plugin (native/extynt-core, AEGP) ────────────────┐
 │ docked panel: macOS WKWebView, Windows WebView2 · native reads and hashes │
 │ watch events · writes run the host library through AEGP_ExecuteScript     │
 └──────────────────────────────────────────┬───────────────────────────────┘
                                             ▼
                                   After Effects 25 or 26
```

## Components

- **Plugin** (`native/extynt-core`). An AEGP plugin that After Effects loads at startup. It owns the docked panel window, answers project reads natively, pushes change events from its watch, and runs writes through the host library. All suite calls happen on After Effects' main thread, in the idle hook. Wire protocol: [`docs/native/protocol.md`](../native/protocol.md). Design: [`docs/native/plugin-design.md`](../native/plugin-design.md).
- **Host library** (`apps/panel/host/*.jsx`, entry `probe.jsx`). The only script text that runs in After Effects. The plugin invokes it by name; a request cannot supply script text. Apply code opens and closes one undo group (`apply-flow.jsx`).
- **Sidecar** (`apps/sidecar`). One per user, started by launchd on macOS and a scheduled task on Windows. It is the stateful authority: chat turns, the agent, plans, the execution queue, receipts, the snapshot and read cache, and the MCP tool boundary. It listens on `127.0.0.1` only and needs no administrator access. Model providers are called from the sidecar.
- **Panel** (`apps/panel`). The chat UI, served by the sidecar at `/ui/` and shown in the plugin's docked WebView. It imports no model package and never calls a provider; it reaches the sidecar over its routes and the plugin only through the page contract in [`docs/native/ui-contract.md`](../native/ui-contract.md).
- **MCP adapter** (`plugin/bin/extynt-mcp`, `packages/mcp-server`). A short-lived stdio process that forwards `tools/call` to the running sidecar. The sidecar stays the only holder of project and plan state.
- **UI text** (`packages/ui-text`). The typed six-language catalogue and language resolution for the panel, the sidecar's user-facing text and the native catalogue window ([UI languages](ui-languages.md)).

## Request flow

1. **Request.** A message arrives from the panel chat, or an external MCP client calls a tool. The panel talks to the sidecar over loopback HTTP; the MCP client goes through `extynt-mcp`. Both reach the same tool code, `callTool` in `packages/mcp-server/src/tool-run.ts` ([one path for tools](panel-mcp.md)).
2. **Read.** The sidecar reads the project through the plugin, or serves it from the cache when nothing changed. Decisions for the job are settled in one batched call per provider at job open (`apps/sidecar/src/decision-prime.ts`), and again at the other moments a job has (frame gate, review, completion).
3. **Agent.** The in-panel agent runs a turn (`server-chat-agent.ts`, `agent-runtime.ts`) with a briefing (`agent-briefing.ts`): the fixed instructions, the operation reference, the runtime state, then the project as the host last read it. The layer list in the briefing is cut to a token budget, and the agent is pointed at `ae_inspect_composition` for the rest. The in-panel agent works through the queue tools (`ae_queue_add`, `ae_queue_design`, `ae_queue_fix`, `ae_queue_finish`); the plan tools are hidden from it. An external client uses `ae_propose_plan`, `ae_amend_plan` and `ae_approve_plan` instead.
4. **Plan.** The agent's operations form a plan. `packages/action-plan` validates it against a fresh snapshot: stale, missing or ambiguous targets are rejected, and operation types and ranges are checked against the connected After Effects version and its host capabilities. A plan is data, never script text. It is presented for approval, or auto-approved where the user enabled that.
5. **Apply.** The sidecar sends the approved plan down the native lane (`apps/sidecar/src/host/lane.ts`, `run-apply.ts`). The lane is event driven, not polled. The plugin runs the host library in one undo group, and sends the write and its verify reads in one idle turn.
6. **Receipt and verify.** The plugin answers with the values it read back from After Effects. The sidecar records a receipt, checks the postconditions against that read, and refreshes its snapshot. A refused proposal applied nothing and returns to the model as a fix to make. A write whose answer never arrived is an unknown receipt: native access is quarantined until it is settled, and the outcome is never guessed.
7. **Report.** The agent is instructed to report three levels separately: planned (the operations were accepted), applied (the receipt says After Effects ran them) and verified (a fresh read confirmed the result). A claim the request makes about the current project is flagged in the briefing, and the agent is instructed to read or measure it before acting on it.

## Decision tiers

Small closed questions (which effect, is this a drawn scene, is the job finished, which font) are typed decision ports in `packages/decide`. A decision can choose only among labels the code offers; it never produces an operation. Every result records which tier answered and, when a tier failed, why.

| Tier | Source | Used for | Confidence |
| --- | --- | --- | --- |
| Deterministic | Pure functions in `packages/decide`. | Every decision. Always available, offline, no network. | Full confidence on its own answer; reports "unsure" when it abstains. |
| Your chat model | The chat provider you already configured, if it supports structured output. | Decisions that opt in, and high-stakes questions the deterministic tier is unsure about. Turned off by `EXTYNT_CHAT_MODEL_DECISIONS=0`. | Not calibrated. Routes with conservative bands, so it overrules the deterministic answer less often. |
| Dedicated decision model | Jev (set `TYPESAFE_API_KEY`), or entries in `EXTYNT_DECISION_MODELS` in one of three dialects: `systemone`, `openai` (any OpenAI-compatible endpoint) or `cloudflare` (Workers AI). | Every decision it is configured for, consulted before the chat model. | Calibrated only if the entry says so; otherwise conservative bands. |

When a dedicated decision model is configured, the chat model is asked only the frame questions, and only if the provider accepts images. Without one, the chat model answers the decisions that opt in.

**Routing by confidence** (`packages/decide/src/route.ts`). A model answer is routed against the decision's bands:

- Below the verify band: dropped (`escalate`), and the next tier answers.
- At or above the act band: taken (`act`).
- In between: taken only if it agrees with the deterministic answer, or leads it by more than 0.15 in probability (or the user's habit favours it). If the deterministic tier abstained, the model's answer is taken in the verify band, unless it is a guarded answer. Otherwise it is a disagreement and falls back. High-stakes decisions fall back on disagreement.

Bands are fitted per decision from held-out evaluations (`fitted-bands.ts`). The chat model's bands are not fitted and stay conservative.

**Fallback** (`decideAll` in `packages/decide/src/decide.ts`). The tiers are tried in order: dedicated decision models, then the chat model. A timeout, a failure, a low-confidence or disagreeing answer, or a question the provider cannot answer hands that decision to the next tier. A high-stakes question the deterministic tier abstains on is retried with the chat model. Whatever is still open is answered by the deterministic function, and the result records the failed provider and reason in its `fallback` field.

- Low confidence falls back to the next tier, ending at the deterministic answer, with the reason `low-confidence`.
- An image question with no frame, or a provider that cannot take images, is withheld from that provider with the reason `image-unavailable`. The deterministic answer stands. A frame goes only to a provider that accepts images, in the one call that provider gets.
- Time limits are latency guards, not workflow caps: 4 seconds for a batch to a dedicated decision model, 30 seconds for a batch to the chat model.
- With no models configured, every decision is answered offline, and nothing touches the network.

## Native plugin

- **Build targets.** `native/extynt-core` is C++ built with CMake; `build-mac.sh` produces `extyntcore.plugin` and `build-win.ps1` produces `extyntcore.aex`. You supply the Adobe After Effects SDK yourself ([ADR 0005](../decisions/0005-manual-adobe-sdk-acquisition.md)).
- **Reads and events.** The plugin reads the open project natively, hashes layers and compositions (XXH3-128 in `core/hash128.cpp`), and pushes `change`, `still`, `overflow` and `host-closing` events from its watch (`core/watch.cpp`). The sidecar folds a burst of edits into one read and fetches only what the plugin cannot supply natively, through the host library. Each read keeps full-read provenance; a read over a size limit is split into pages, never truncated.
- **Writes.** `AEGP_ExecuteScript` runs the host library by name on the main thread. Each write is followed by a native read that verifies the result in the same batch.
- **Wire.** Newline-delimited JSON over TCP on `127.0.0.1`, one object per line. The port and a 64-hex-character token come from the discovery file `native.json`, which is written with mode 0600. A request without the right token gets `UNAUTHORIZED`.
- **Timeouts.** A native call that times out, is quarantined, or may have run is reported as a transport failure (`HOST_TIMEOUT`, `HOST_QUARANTINED`, `HOST_DISPATCH_UNKNOWN`).

## Windows: the WebView2 host

On Windows the panel is a child window of After Effects' docked container, with a WebView2 controller for the page (`native/extynt-core/ae/ae_panel_win_*.cpp`). The macOS panel is the same design on a WKWebView (`ae_panel_view.mm`).

- **Focus.** When the host window gets focus, the page takes it; a mouse press in the host moves focus into the page. When focus leaves the panel and comes back, the page regains focus after a short timer. The panel's theme follows After Effects' theme.
- **Floating window.** The panel subclasses its floating frame to keep a minimum content size.
- **Installer.** `packaging/windows/extynt.iss` is an Inno Setup installer that requires administrator rights. One elevated step (`elevated-step.ps1`) writes the plugin into each After Effects Plug-ins folder and the host library under `%PROGRAMDATA%\extynt`. Per-user steps run as the original user.
- **Node runtime.** The bundle ships a pinned Node runtime (`packaging/windows/node-runtime.env`), so users do not install Node.
- **Build check.** The gate runs a Windows syntax check with a pinned mingw-w64 cross compiler (`scripts/lib/mingw-toolchain.ts`) where that toolchain is available.
- **Open risks.** Windows has had less real-hardware testing than macOS; the open items are in [`docs/platforms/windows.md`](../platforms/windows.md). Install and privilege facts: [ADR 0041](../decisions/0041-install-and-privilege-model.md).

## Plans

A plan is data: intent and summary, the project revision or snapshot fingerprint, resolved targets, typed operations, preconditions, expected changes, postconditions and provenance. There are no canned intents; a model writes typed operations directly.

| Runtime | Plan tools |
| --- | --- |
| In-panel agent | `ae_queue_add`, `ae_queue_design`, `ae_queue_fix`, `ae_queue_finish`. The `ae_plan_*` and `ae_propose_plan` tools are hidden from it. |
| External MCP client | `ae_propose_plan`, `ae_amend_plan`, `ae_approve_plan`, `ae_plan_create`, `ae_plan_add`, `ae_plan_complete`, plus the read, capability and undo tools. |

`workflow-v1` (`packages/workflow`) is the only workflow engine ([ADR 0039](../decisions/0039-single-workflow-engine-and-sidecar-apply-decision.md)).

## Trust boundary

The model calls typed tools only. The sidecar validates, previews, applies through the plugin and verifies. There is no unvalidated scripting escape hatch. Untrusted input (HTTP bodies, tool arguments, plugin replies, ExtendScript results, model responses, environment and files) is decoded once at each boundary by `packages/decode`. Model provider credentials resolve in the sidecar process and never appear in snapshots, model context, diagnostics or committed files ([ADR 0012](../decisions/0012-llm-provider-boundary.md)). A provider receives no more project data than the context package the user approved.

## Packages

| Package | Role |
| --- | --- |
| `action-plan` | Validates plans against a snapshot, binds one-time approvals and derives review warnings. The model-facing safety boundary. |
| `capability-catalogue` | What After Effects can do, what this computer has, and how far each plan type can be trusted. Facts about third-party plugins come only from collection on the user's machine. |
| `collection` | Sidecar-side coordinator that gathers host facts page by page at run time. A timeout quarantines it; it never cancels a host getter. |
| `decide` | Decision ports: the three tiers, the resolver, routing and fallback, and the request and resolution vocabularies. |
| `decode` | Turns untrusted input into exact types at every boundary. |
| `host-ae` | Compiles approved plans and capture requests into host commands, and reads postconditions back. |
| `host-native` | The wire contract between the sidecar and the plugin: discovery, identity and the client. |
| `llm` | Provider-neutral model boundary, structured output and the provider adapters. |
| `mcp-server` | The tool catalogue, schemas, validation, target resolution and the stdio JSON-RPC adapter. |
| `project-graph` | The serializable snapshot of the open project, its fingerprints and queries. |
| `ui-text` | The panel's words in English, Spanish, German, French, Japanese and Simplified Chinese, and the lookup that picks one. |
| `visual-evidence` | Bounded capture requests for frames and frame summaries. Capture stays on this computer. |
| `workflow` | The `workflow-v1` lifecycle: reducer, validators, projections and event-log stores. |

Other parts of the repository:

| Path | Role |
| --- | --- |
| `apps/sidecar` | The Node sidecar process: server, chat and agent turn, plans, queue, receipts, and the native lane. |
| `apps/panel` | The chat UI (`runtime/`, entry `entry.ts`, `index.html`) and the host library (`host/*.jsx`). |
| `native/extynt-core` | The AEGP plugin, its panel hosts (`ae/`), the core (`core/`) and the catalogue window. |
| `plugin/` | The workflow skill and the MCP launcher. Skills explain tool use and implement no host mutation. |
| `tools/chat-tests` | Drives the in-panel agent through composition requests; offline by default, live with `--live`. |
| `tools/fake-plugin` | A scripted TCP fake of the plugin that speaks the full wire protocol, so tests run without After Effects. |
| `tools/host-verification` | A live verification kit that applies every plan type in After Effects and reads the result back. |
| `tools/native-spike` | Measures and verifies the native plugin against the ExtendScript probe. |

## Where to look

| Question | Start at |
| --- | --- |
| How does a chat turn run? | `apps/sidecar/src/server-chat-route.ts`, `server-chat-agent.ts`, `agent-runtime.ts` |
| How does the sidecar talk to the plugin? | `apps/sidecar/src/host/` (`link.ts`, `lane.ts`, `run-apply.ts`), `packages/host-native` |
| What can a tool call do? | `packages/mcp-server/src/`, `packages/capability-catalogue/src/` |
| How is a plan compiled to host commands? | `packages/host-ae`, `packages/action-plan` |
| How is a decision settled? | `packages/decide/src/decide.ts` (tiers and fallback), `route.ts` (confidence bands) |
| How does the panel render? | `apps/panel/runtime/` (entry `entry.ts`) |
| What does the host library do? | `apps/panel/host/*.jsx` |
| How is it tested without After Effects? | `tools/fake-plugin`, `tools/chat-tests`, `tools/host-verification` |
| Verification claims | [`verification-and-plugin-evidence.md`](../verification-and-plugin-evidence.md) |
