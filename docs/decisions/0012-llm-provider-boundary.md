# 0012: Provider-neutral model boundary

Status: accepted

## Context

extynt is bring-your-own-model: the user chooses the provider, the model and the
credential. The agent logic, the plan contract and the host must not depend on
which provider answers, and no provider may gain authority over After Effects.

## Decision

`packages/llm` defines a provider-neutral JSON contract over a bounded
`ProjectSnapshot`. A provider implements one completion interface and maps the
contract to its native API. Adapters exist for Anthropic Messages, OpenAI
Responses and a configurable OpenAI-compatible endpoint (used for xAI, DeepSeek
and custom services), plus a mock provider for tests. The sidecar's model
settings (`apps/sidecar/src/llm-config.ts`) list the services the user can pick
from.

The package has no mutation tools, no host calls and no script path. Any action
a model proposes enters the typed action-plan validation boundary
([ADR 0001](0001-typed-action-plans.md)).

### Credential boundary

Provider configuration holds only displayable metadata: provider id, endpoint,
model, auth source and display fields. Credential material is resolved by a
server-side `SecretSource`, from a sidecar environment variable or a local
in-memory or stored secret, at request time so rotation takes effect without a
restart. It never appears in a panel payload, snapshot, model context, provider
config JSON, diagnostics, committed file or evidence archive.

### Training policy

Each model service carries a `trainingPolicy`. Anthropic, OpenAI, OpenRouter,
Ollama and the mock provider are `no-training`. Google, DeepSeek, xAI, custom
and custom-anthropic are `may-train`, except that a custom service whose base
URL host is loopback (`127.0.0.1`, `localhost`, `::1`) is `no-training`.

A `may-train` slot works only after the user accepts it. The panel shows the
reason and an unchecked box; saving is blocked until it is ticked. The tick is
stored as `AE_LLM_ALLOW_TRAINING_RISK=1` (`AE_LLM_FALLBACK_ALLOW_TRAINING_RISK`
for the fallback slot). Changing a slot's service clears it.

The sidecar enforces this where it builds providers
(`createModelSettingsStore` in `apps/sidecar/src/llm-config.ts`): an
unacknowledged `may-train` provider refuses `step` and `complete` before any
network call, and in-panel web search checks the same slot first. Fetching a
model list stays allowed. The refusal is not retried on the fallback slot.

Every OpenRouter request body carries `provider: { data_collection: "deny" }`,
merged into any `provider` object already there, including `openrouter/auto`.

## Consequences

- The model-facing contract stays portable across providers and is testable
  without network or host access.
- Provider-specific behavior is isolated in mapping adapters.
- Redaction and bounded context keep model-bound text free of secrets and
  paths ([ADR 0013](0013-sanitized-diagnostics.md)).
- The user owns the credential's lifecycle: shell history hygiene, crash-log
  review and provider-side key revocation.
