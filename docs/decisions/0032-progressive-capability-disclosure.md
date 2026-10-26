# ADR 0032: progressive capability disclosure and the stable model surface

Status: accepted

## Context

The native-operation registry is intentionally broad: it is the typed
vocabulary that lets the model compose original work without recipes or
generated host code. Sending every registry field and every lifecycle tool on
every turn makes that vocabulary harder to use and encourages the model to
carry execution bookkeeping that belongs to the sidecar.

The model-facing surface therefore needs two properties at once:

1. a small, stable set of tools for context, discovery, queueing, observation,
   and guarded control; and
2. an open-ended typed operation vocabulary that can be inspected when the
   active stage needs it.

The in-panel agent, external MCP clients, and the sidecar briefing must
describe the same registry. A second hand-written schema or a recipe catalogue would drift
from the validators and would falsely imply that the model can execute raw
JSX or arbitrary generated host code.

## Decision

### Keep one stable agent surface

The in-panel agent receives the queue-generation tools and the read-only
inspection/discovery tools it needs for the current decision. The plan-id
lifecycle tools serve external MCP clients and are not advertised to the
queue agent. Plan ids, batch counters, receipt
correlation, retry state, and provider wake-up are sidecar concerns; they are
not part of the model contract.

The model still proposes only typed operations. The operation registry is a
declaration and schema source, never an executor. Accepted operations pass
through the existing validator, policy, compiler, and host boundary.
No disclosure path introduces recipes, raw JSX, or arbitrary generated host
code.

### Disclose capability in bounded levels

The normal sequence is intentionally progressive:

1. `ae_get_bootstrap_context` establishes the current bounded context and the
   next useful read.
2. `ae_list_native_operations` gives compact registry counts and host-specific
   verification coverage.
3. `ae_search_native_operations` returns bounded operation-family rows for a
   relevant query.
4. `ae_describe_native_operation` returns one operation's scoped input schema,
   plan shape, worked example when available, verification status, and sibling
   coverage. A plan type served by several registry entries names those entries
   rather than pretending one schema is the whole capability.
5. `detail: "full"` is an explicit audit request for registry provenance,
   host-version gate, verification basis, and the full plan-type contract.

Host capability discovery follows the same distinction: search and summary
answers are bounded, while control paths, usage, and evidence are paged detail
surfaces. Catalogue knowledge is not host evidence; a capability that has not
been searched or probed remains unknown.

The sidecar briefing carries the generated operation reference needed for
ordinary authoring. It points the model to detail discovery only when the
reference does not cover an operation or a field range/example is material.
This keeps common turns compact without shrinking the typed vocabulary.

### Use one generated source of truth

`NATIVE_OPERATION_REGISTRY` is the source for operation ids, plan-type
coverage, schemas, implementation status, host gates, provenance, and
evidence labels. The operation reference and MCP discovery responses derive
from that registry and the plan-type contracts used by validation. Changes to
an operation therefore update the model briefing, discovery tools, and
contract tests together.

All discovery responses are bounded and may report truncation or a next step.
The caller may request more detail, but the server never silently expands the
normal response until it becomes an unbounded prompt or host capability dump.

## Consequences

- Lower-capability models can author against a small, predictable surface while
  still reaching the complete typed operation vocabulary.
- Full registry provenance and host gates remain auditable without spending
  every model turn on metadata that is irrelevant to the active stage.
- Multi-entry plan types cannot silently collapse to the first registry entry;
  the response names sibling entries and describes the requested shape.
- Panel and fake-host tests can verify catalogue shape, disclosure bounds,
  and protocol wiring, but they cannot certify real After Effects support,
  actual undo grouping, or host read-back behavior.
- Discovery never grants a mutation, approval capability, retry, restart, or
  provider continuation. `resumeSupported` remains descriptive only.

## Rollout gates

Before enabling this surface as the default for a new provider or host build,
the evaluation harness must demonstrate:

- representative multi-stage jobs complete using the stable queue surface;
- lower-capability models can find and correctly use relevant schemas without
  relying on hidden lifecycle ids or recipes;
- bounded search, detail paging, sibling coverage, and truncation remain
  truthful under large registries and host inventories;
- unavailable, fixture-backed, and host-verified evidence stays distinct;
- fake-host green tests are supplemented by real-After-Effects validation for
  the supported build, including undo, read-back, and callback-loss cases; and
- restart never dispatches a host command, reuses an approval capability,
  wakes a provider, or retries a mutation automatically.
