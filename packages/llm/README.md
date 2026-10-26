# LLM project copilot foundation

`@extynt/llm` is the provider-neutral, read-only model boundary for
project explanation. It consumes a normalized `ProjectSnapshot` and produces a
typed `ChatResponse`. It does not import the panel, the host library, or any
mutation/action-plan executor.

## Files

- `src/types.ts` — versioned provider-neutral JSON contracts for chat, bounded
  context, provider configuration, BYOK sources, and diagnostics.
- `src/context.ts` — deterministic active-selection context projection. The
  default set includes host facts, project identity, the active composition,
  selected layers, parent ancestors, and only referenced sources.
- `src/redaction.ts` — bounded secret/path/string redaction for prompt and
  context data.
- `src/provider.ts` — `runChat`, the read-only system boundary, response
  redaction, and phase-only temporary diagnostics. Diagnostic events never
  contain prompt, context, response, or credential bodies.
- `src/provider-config.ts` — provider ID, endpoint, model, auth-source, safe
  display metadata, server-environment secrets, and rotatable local secret
  input.
- `src/mock.ts` — deterministic no-network provider for local contract tests.
- `src/anthropic.ts` — native Anthropic Messages API adapter for Claude models,
  exported through `@extynt/llm/anthropic`.
- `src/openai.ts` — OpenAI Responses adapter plus configurable OpenAI-compatible
  adapter (used for OpenAI-compatible services such as xAI, OpenRouter,
  Ollama and DeepSeek, which has a ready-made profile), exported through
  `@extynt/llm/openai`.
- `src/provider-wire.ts` — explicit native Anthropic Messages, OpenAI Responses,
  and OpenAI-compatible chat request/response JSON shapes used by the adapters.
- `tests/llm-*.test.ts` — deterministic context/redaction/orchestration tests and
  fake-fetch mapping fixtures. These tests do not call After Effects, OpenAI,
  Anthropic, or any other provider.

## Provider-neutral chat

```ts
import { MockProvider, runChat } from "@extynt/llm";

const response = await runChat({
  schemaVersion: "0.1",
  requestId: "chat-001",
  message: "What is selected?",
  snapshot,
}, new MockProvider());
```

The model receives a bounded projection, not the raw snapshot. File paths are
redacted by default, expressions are omitted by default, string values are
bounded, and project text is marked untrusted in the provider prompt.

## Bring your own model: adapters and profiles

`ProviderConfig` is safe-to-display metadata only: provider ID, HTTPS endpoint,
model, auth source, and optional display name. It never contains the key. A
`SecretSource` resolves the key on the server at request time. Use
`createServerEnvironmentSecret` for sidecar environment variables or
`createLocalSecretInput` for a server-local secret entry. The local source can
be replaced or cleared for rotation without changing provider config.

```ts
import { createLocalSecretInput } from "@extynt/llm";
import { OpenAICompatibleProvider } from "@extynt/llm/openai";

const secret = createLocalSecretInput(localSecretEntry);
const provider = new OpenAICompatibleProvider({ config, secretSource: secret });
```

The user chooses the provider; the sidecar (`apps/sidecar/src/llm-config.ts`)
maps that choice to one of these adapters. Credentials must never be placed in
panel payloads, snapshots, model context,
provider config JSON, logs, committed files, or user-visible diagnostics.
Rotate environment-backed credentials by replacing the sidecar environment and
restarting/reloading the server process according to its deployment policy.
Rotate local input by calling `replace`, validate the next request, then call
`clear` on the old in-memory source when it is no longer needed. Do not persist
raw keys in crash reports, shell history, or evidence archives.

The native Claude adapter maps provider-neutral history/context into the
Anthropic Messages request and maps text blocks back to `ProviderCompletion`.
The OpenAI-compatible adapter maps the same contract to `/chat/completions`.
Any base URL and model can be supplied, so one adapter serves every
OpenAI-compatible service. `DEEPSEEK_FLASH_PROFILE` is one ready-made profile
among them (`https://api.deepseek.com`, `deepseek-flash`). The OpenAI
Responses adapter uses `/responses`.

This package is a foundation only. It has no model tools, mutation operations,
raw JSX path, direct host calls, or action-plan execution authority.
