# ADR 0013: sanitized diagnostics

Status: accepted

## Context

Troubleshooting needs a way to follow one request across the panel and the
sidecar, and to tell transport, validation and response failures apart. Logs
that carry free text, URLs, headers, bodies or project values would turn
diagnostics into a copy of the user's project or a credential sink.

## Decision

Diagnostics are a versioned event shape (`schemaVersion` `0.1`) implemented in
`apps/sidecar/src/diagnostics.ts`. Every
event passes through an allowlist projection before it is emitted. An event has
only:

- an event name, phase and level from closed sets;
- correlation and request ids restricted to `[A-Za-z0-9._:-]{1,128}`;
- method, a route from a closed route set (`/unknown` otherwise; the raw URL is
  never recorded) and outcome (`started`, `succeeded`, `rejected`, `failed`);
- status code, byte count, bounded duration and an error code matching
  `[A-Z0-9_]{1,64}`; the panel shape adds response-character count, ready state
  and `tokenPresent`, never the token; and
- an ISO timestamp.

There is no free-form message, header, request or response body, project or
layer name, path, expression, token or arbitrary metadata field. Any value
outside its allowlist is replaced by a safe default.

Structured logging is off by default. The sidecar enables it only when
`AE_DIAGNOSTICS=1` and `NODE_ENV` is not `production`, and writes one
`[extynt diagnostic]` line per event to the debug console. Emission is
best-effort and never blocks a request.

`GET /v1/diagnostics/export` returns a bounded summary: service, loopback flag,
Node version, host runtime, the latest snapshot's request id, time and size,
inventory fingerprint and counts, and request counters. It contains no project
content.

Model-bound and agent-visible text is redacted separately. `redactText` in
`packages/llm/src/redaction.ts` replaces private keys, bearer tokens,
`sk-`/`rk-`/`pk-` style keys and `api_key`/`token`/`secret`/`password`
assignments with `[redacted secret]`, replaces file paths with
`[redacted path]` unless paths are explicitly included, and truncates long
strings. Host receipts shown to the agent drop bearer values, tokens and paths.

## Consequences

- Panel and sidecar events join on the correlation id and show the failing
  phase and its duration without exposing project content.
- The two allowlists must stay in step; a change to one is a change to both.
- Enabling diagnostics in production, or logging raw errors, payloads, headers
  or host object-model values, is a separate decision.
