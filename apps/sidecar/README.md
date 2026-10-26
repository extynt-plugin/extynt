# Sidecar

The per-user loopback Node process at the centre of extynt. It serves the panel UI, drains the agent's work through the native plugin, answers MCP calls from external agents, and owns model configuration. It has no Adobe SDK, native module, global runtime install, or arbitrary execution endpoint; it uses Node's built-in `http` module, and every change to a project goes through a typed, approved plan.

## What it does

- **Native lane (`src/host/*`).** The extynt plugin inside After Effects is the host. The sidecar finds the plugin's endpoint file (`native.json`), connects to it with backoff, reports the link as online, stalled or offline, and drains its mailbox of reads, applies, previews, captures and undos through that link. When After Effects quits the sidecar stays up and reports `HOST_OFFLINE`.
- **UI server (`/ui`).** `GET /ui/` serves the files listed in `apps/panel/ui-manifest.json`, built by `scripts/build-panel.ts`. An installed sidecar serves them from its install location (`EXTYNT_UI_DIRECTORY`, an absolute path); unset, it serves the repository's `apps/panel`. The panel talks to `/v1/ui/*` (bootstrap, prefs, sessions, events) and `/v1/chat` with the token the plugin injects as `window.__extyntNative`.
- **MCP routes.** `GET /v1/mcp/tools` and `POST /v1/mcp/tools/call` back the launcher in `packages/mcp-server` that Claude Code, Claude Desktop and Codex run (plugin/). Plans from external agents go through `ae_propose_plan` and `ae_approve_plan`; the in-panel agent uses the `ae_queue_*` and `ae_plan_*` tools.
- **Model configuration (bring your own model).** The user picks a provider in the panel (Anthropic, OpenAI, xAI, DeepSeek, OpenRouter, Ollama, any OpenAI-compatible or Anthropic-compatible endpoint, or the offline mock) and supplies their own key. The service list is `MODEL_SERVICES` in `src/llm-config.ts`. Settings and keys are stored in `llm.env` in the per-user state directory; a development `.env` in the working directory and real environment variables override it, in that order. The environment names use an `AE_LLM_` prefix (`AE_LLM_PROVIDER`, `AE_LLM_MODEL`, `AE_LLM_BASE_URL`, `AE_LLM_API_KEY`, `AE_LLM_FORMAT`, `AE_LLM_CONTEXT_WINDOW`, `AE_LLM_REASONING_EFFORT`, `AE_LLM_STREAM`, `AE_LLM_ACCEPTS_IMAGES`, `AE_LLM_ALLOW_TRAINING_RISK`, and `AE_LLM_FALLBACK_*` for a fallback model); set `AE_LLM_PROVIDER` to your provider. With no model configured, chat returns `LLM_NOT_CONFIGURED`. Credentials stay on this computer, in the sidecar, and are never sent to the panel.
- **State directory.** macOS `~/Library/Application Support/extynt`, Windows `%LOCALAPPDATA%\extynt` (never `%APPDATA%`, so tokens and the WebView2 profile do not roam), `~/.config/extynt` elsewhere. It holds the session file (port and bearer token, owner-only permissions), `llm.env`, the project graph, plans, chat logs and the effect catalogue. The session file is the only place the bearer token is published: loopback is reachable by anything on the machine, including a browser page, so no HTTP route hands the token out.

## Workflow ownership and delegation

Every in-panel chat turn that a tool-calling model can own runs as a
`workflow-v1` job; there is no other in-panel engine
([ADR 0039](../../docs/decisions/0039-single-workflow-engine-and-sidecar-apply-decision.md)).
The top-level model role is the **orchestrator/validator**.
It owns the user outcome, validates every handoff and receipt, and is the only
role admitted to stage, queue, seal, or complete workflow work. Three bounded,
read-only consultations can advise it:

- visual/scene: layer manifest, vector detail, masks/mattes, and z-order;
- motion: trajectories, timing, orientation, and continuity;
- execution: dependency-complete After Effects stages and operation families.

The handoff preserves a scene/layer manifest, masks and z-order, motion
continuity, a requirement checklist, and required verification frames/evidence.
Specialists receive project context but no tools. Their JSON output is validated
and bounded before it enters the orchestrator briefing. Role-specific providers
can be supplied through `SidecarOptions.workflowSpecialistProviders`. An omitted
role falls back immediately to the primary owner instead of making a duplicate
provider call. Configured consultations run concurrently under one bounded
window, so unavailable specialists cannot delay the actual author for a minute.

If any specialist is unavailable or returns an invalid handoff, the bundle is
marked `partial`; if all fail it is marked `single-agent-fallback`. Neither case
blocks the established single-agent workflow. The execution boundary is still
enforced in code: a workflow tool call without the sidecar-assigned
`orchestrator-validator` role is refused with `WORKFLOW_OWNER_REQUIRED`, including
calls made directly through the lower-level native-tool capability.

Specialists never reason past `medium` effort, whatever the slot's effort: each
returns one bounded JSON handoff while the owner waits on it. A completed
specialist turn wakes the owner once. When a job completes, is cancelled, or
blocks with no receipt left to reopen it, its specialists are stopped and their
transcripts dropped.

## Apply decision

The sidecar decides, for every batch it hands the panel, whether the panel may
commit it without a click: `autoApply` on each `GET /v1/chat/plans/ready` entry
and each reply plan card. It is true only when the request carried the panel's
auto-apply toggle as on and the agent did not hold the batch with
`ae_queue_finish` `review: true`, which it is briefed to do when the user asks
to see or approve the change first. The sidecar does not parse the message for
review phrasing. A hold covers every later batch of the same request. The
panel commits only a batch marked true while its own toggle is on; a missing
flag means waiting for Apply.

## Model capabilities

What a model accepts is the model's own report, never a table of model names
(`packages/llm/src/model-capabilities.ts`):

- The running sidecar asks each configured model once, when it is built: the
  Anthropic adapter reads `GET /v1/models/{id}` (`capabilities.effort`,
  `capabilities.thinking`, `capabilities.image_input`, `max_tokens`); the
  OpenAI-compatible adapter reads the model's row in `GET /models`, where
  OpenRouter and xAI list input modalities.
- A provider that publishes nothing is asked by its first request. A `400`
  that names a field the model does not take (`thinking`, `reasoning_effort`
  with the levels it accepts, `thinking.display`, an image) is recorded and
  the step is sent again without it, up to three lessons per step.
- An effort the model does not list becomes the nearest level it does. A model
  that reports no image input is sent a note that the frame was withheld
  instead of the frame; one nothing has reported on is offered frame capture.
  `AE_LLM_ACCEPTS_IMAGES=true|false` is the user's own answer and wins.
- `GET /v1/settings/model` returns `active.primary.efforts` (null until the
  model has named them) and `imagesReportedBy` (`setting`, `model`, or
  `unreported`); the panel's effort menu offers only the reported levels.
- Learned capabilities are kept for the life of the sidecar, across settings
  saves, per format, base URL, and model.

Steps before a workflow stage is selected run at `medium` effort (a slot set
lower keeps its own choice); the selected stage runs at the slot's effort.

Goals that claim appearance or motion receive typed `visual` and/or `temporal`
success criteria. Structural write/read-back receipts cannot satisfy those
criteria; completion requires matching rendered-frame or sampled-motion evidence.
A successful local `ae_observe_frame` records typed visual observation evidence
against the current workflow job and stage. One frame does not prove motion:
temporal completion still requires typed sampled-motion evidence across time.

Endpoints:

- `GET /health` — service, version, schema and liveness.
- `GET /ui/` and `GET /v1/ui/*` — the panel files, bootstrap, preferences, sessions and the server-sent event stream.
- `POST /v1/chat`, `/v1/chat/progress`, `/v1/chat/steer`, `GET /v1/workflow/status`, `/v1/chat-logs`, `/v1/chat-logs/export` — the in-panel agent turn, its progress and its logs.
- `GET/POST /v1/settings/model`, `/v1/settings/model/efforts`, `/v1/settings/model/test` — model configuration.
- `GET /v1/mcp/tools` and `POST /v1/mcp/tools/call` — MCP discovery and calls.
- `POST /v1/receipts`, `GET /v1/receipts/latest`, `GET /v1/changes` — receipts and the change history.
- `POST /v1/snapshots`, `GET /v1/snapshots/latest` — the project snapshot the sidecar holds.
- `/v1/suggestions`, `/v1/variants`, `/v1/notes/*` — suggestions, variants and effect notes. `POST /v1/catalogue/start` and `POST /v1/host/census` are used by the panel's Developer page.
- `GET /v1/diagnostics/export` — sanitized troubleshooting export.
- `POST /execute`, `/mutate` and `/v1/execute` — always rejected with `405`.

The listener binds only to IPv4 loopback (`127.0.0.1`) and also checks the peer address. The default port is `3210`; set `AE_BRIDGE_PORT=0` for an ephemeral development port. Request bodies are bounded to 2 MB by default. All non-preflight requests require the bearer token (`AE_BRIDGE_TOKEN`, or a random one generated at startup and written to the session file). A browser preflight is always refused. Other settings: `AE_AGENT_MAX_STEPS` (runaway backstop per turn), `AE_WORKFLOW_MAX_CYCLES`, `EXTYNT_CATALOGUE_PROBE=0` (turn the background effect catalogue probe off).

## Temporary diagnostics

Structured diagnostics are disabled by default. For a development run, set `AE_DIAGNOSTICS=1` while leaving `NODE_ENV` unset or set to `development`:

```sh
AE_DIAGNOSTICS=1 NODE_ENV=development pnpm bridge:start
```

The logger emits one JSON event per request or phase boundary, including bounded IDs, route class, status, byte counts and timing. It never emits the bearer token, request or response bodies, project contents, or arbitrary error text. `NODE_ENV=production` disables it even if it is explicitly enabled.

Build and run from the repository root:

```sh
pnpm bridge:start
```

The source has no native dependencies. A packaged install runs it with the bundled Node runtime from the installer, so no global Node installation is assumed.
