# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0 — first public release

2026-10-25

### The app

- **Native plugin.** An After Effects plugin for macOS (`.plugin`) and Windows (`.aex`) that hosts the docked panel,
  answers project reads natively, watches for changes, and applies edits in one undo group.
  See [plugin design](docs/native/plugin-design.md) and the [wire protocol](docs/native/protocol.md).
- **Panel.** A single chat surface served by the sidecar and shown in the plugin's docked WebView.
- **Sidecar.** A per-user loopback Node process that runs the chat and agent loop, plans, the execution queue, receipts,
  reads and model providers. It listens on `127.0.0.1` only and needs no administrator access.
- **MCP server and tools.** Typed tools for reading the project, searching capabilities, proposing, approving and
  undoing plans, so that any MCP client can drive After Effects through the same code as the
  panel ([connect an agent](docs/connect-an-agent.md), [one path for tools](docs/architecture/panel-mcp.md)).
  Nine declared tools are answered only by the sidecar; the standalone adapter refuses them with
  `UNSUPPORTED_TOOL`: `ae_query_relational_graph`, `ae_describe_control`,
  `ae_prepare_parameter_change`, `ae_read_effect_notes`, `ae_write_effect_note`, `ae_query_graph_cache`,
  `ae_read_graph_page`, `ae_get_graph_page` and `ae_check_request`.
- **Bring your own model.** Anthropic, OpenAI, Google, DeepSeek, xAI, OpenRouter, any compatible endpoint, or a local
  model through Ollama.
- **Decision models.** Small closed questions (which effect, is this a drawn scene, is the job finished) are answered by
  typed decision ports with three tiers: a deterministic default, the model you already use, and an optional
  dedicated decision model (Jev, a System One-compatible server, an OpenAI-compatible endpoint, or Cloudflare Workers
  AI). Confidence bands are fitted per decision from held-out evaluations. See [ADR 0045](docs/decisions/0045-decision-models.md).
  - By default, when no decision model is configured and the chat provider supports structured output, one batched
    decisions call per job goes to your chat model. Set `EXTYNT_CHAT_MODEL_DECISIONS=0` to opt out.
  - A decision model that is not marked calibrated routes with conservative bands, so it overrules the deterministic
    answer less often.
- **Supported versions.** After Effects 25 and 26 (26 is the measured target), macOS 13.5 or newer, Windows 10
  (version 1809) or 11 on x64. Installers bundle a Node 26 runtime, so no global Node install is needed.
- **Distribution.** Signed builds are published on the repository's GitHub Releases page. There is no paid store.

### Decisions

- **Three tiers answer each small question.** A deterministic tier always answers, offline. Your own chat model answers
  the questions that opt in, and the high-stakes ones the deterministic tier is unsure about. An optional dedicated
  decision model is consulted first: Jev (set `TYPESAFE_API_KEY`), or an entry in `EXTYNT_DECISION_MODELS` in the
  `systemone`, `openai` (any OpenAI-compatible endpoint) or `cloudflare` (Workers AI) dialect.
- **Confidence decides what is taken.** A model answer is taken when it is confident, dropped when it is below the
  lower band, and between the bands taken only when it agrees with the deterministic answer or clearly leads it.
- **Fallbacks are recorded.** A failed, timed-out, low-confidence or disagreeing answer passes to the next tier, and the
  result names the provider and the reason. A question about a frame with no frame, or a provider that cannot take
  images, falls back with the reason `image-unavailable`.
- **Decisions choose, they do not write.** A decision can pick only from labels the code offers. It never produces an
  operation.
- **Frames go only to image providers.** A frame is sent only to a provider that accepts images, in the one call it gets.
- **Your chat model can be kept out.** Set `EXTYNT_CHAT_MODEL_DECISIONS=0` to stop the chat model answering decisions.
- **Offline by default.** With no model configured, every decision is answered without any network request.

### Agent and briefing

- **Briefing order.** The agent's briefing lists its fixed instructions, the operation reference and the runtime state,
  then the project as the host last read it. The layer list is cut to a token budget, and the agent is told where to
  find the rest.
- **Queue-based in-panel agent.** The in-panel agent builds work through the queue (add, design, fix, finish). The plan
  lifecycle tools are hidden from it.
- **Three levels of status.** The agent is instructed to report what was planned, what was applied and what a fresh
  read verified as three separate things.
- **Scale notes only when needed.** A numeric value gets a scale note only when it lies outside the range the control
  reports.

### Panel

- **Approval as a waiting item.** A design shown for approval waits in the chat with a Build it button.
- **Markdown tables render** in chat replies.
- **Only the sidecar is called.** The panel imports no model package and calls no provider.

### Windows

- **WebView2 panel host.** The panel is a WebView2 page inside After Effects' docked container.
- **Focus returns to the page.** When the After Effects window is reactivated, the keyboard goes back to the panel.
- **One administrator step.** The installer requires administrator rights, runs one elevated step to write the plugin
  and the host library (under `%PROGRAMDATA%\extynt`), and runs the rest as the signed-in user.
- **Scheduled sidecar.** On Windows the sidecar is started by a scheduled task.
- **Windows syntax check in the gate.** The gate compiles the Windows sources with a pinned mingw-w64 compiler where that
  toolchain is available.

### Fonts and effects

- **Substitutes for missing fonts.** When a named font is not installed and the font list is complete, the agent is
  pointed at the installed family that best fits the look, told to set the font by its PostScript name so bold and
  italic stay real, and told to say in its reply which font it used.
- **No questions about missing fonts.** A question about a font a complete list lacks is refused, unless the user
  insisted on that exact font. A partial font list never refuses.
- **Loose effect words need a habit.** A word such as "twist" names no effect alone. A habit decides between Twirl and
  CC Twister; without one the resolver abstains.

### Honesty

- **Claims about the project are flagged.** A request that states how the project is now (where something starts, what
  was undone) is flagged in the briefing, and the agent is instructed to read or measure it before acting.
- **Font substitutes are disclosed in instructions.** The agent is told to say which installed font stood in for a
  missing one. This is a prompt-level instruction, not a checked field.
- **Claims are guarded.** An apply claim must carry the plan's approval and a current snapshot. An undo claim must be
  admitted by the workflow coordinator. A refused claim says why.

### Tooling and evals

- **The gate.** `pnpm check` runs structure, comment and header checks, dead-export checks, whitespace and format,
  banned-token and shell checks, build, lint, typecheck, workspace tests, headless validation and the native core checks,
  one PASS or FAIL line per stage.
- **Offline by default, live tests opt-in.** `pnpm check` and `pnpm test` never read a model key, so the live decision
  suites skip there. `pnpm test:live` runs only the live suites with your key; each passes at a minimum accuracy, and a
  wrong model answer is printed as a miss.
- **Chat tests.** `tools/chat-tests` drives the in-panel agent through composition requests. It runs offline by default,
  and against a configured model with `--live`.
- **A fake plugin.** `tools/fake-plugin` speaks the full wire protocol, so the sidecar and tests run without After Effects.
- **Host verification.** `tools/host-verification` applies every plan type in After Effects and reads the result back.

### Developer experience

- One quality gate (`pnpm check`) with strict limits for every language, no exceptions. See [coding rules](docs/coding-rules.md).
- Zero runtime dependencies in the shipped code; the sidecar uses Node's built-in `http`.
- TypeScript everywhere except the ExtendScript host library, the native plugin and the packaging scripts.
  Untrusted input is decoded once at each boundary with `@extynt/decode`.
- `pnpm check` and `pnpm test` run on Linux, macOS and Windows without After Effects, using a fake plugin and
  synthetic fixtures.

### Known limitations

- Windows has had less real-hardware testing than macOS. The open Windows-specific items are listed under
  "Known risks" in [docs/platforms/windows.md](docs/platforms/windows.md).
- After Effects 25 is supported but less tested than 26; a version newer than 26 runs as experimental.
- The decision tiers that use your own language model and the OpenAI-compatible and Cloudflare dialects have been
  tested only against injected responses, not against live services. The fitted confidence bands are provisional.
- You supply the Adobe After Effects SDK yourself to build the native plugin ([ADR 0005](docs/decisions/0005-manual-adobe-sdk-acquisition.md)).
