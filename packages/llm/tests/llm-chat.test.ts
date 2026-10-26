/** Chat, context selection, diagnostics, and provider-config checks for the llm package. */

import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot } from "@extynt/project-graph";
import {
  MockProvider,
  redactDiagnosticEvent,
  runChat,
  selectProjectContext,
  type DiagnosticEvent,
} from "../src/index.js";
import { ProviderHttpError } from "../src/anthropic.js";

test("context selection is deterministic and bounded to the active selection", () => {
  const first = selectProjectContext(representativeSnapshot).context;
  const second = selectProjectContext(representativeSnapshot).context;
  assert.deepEqual(first, second);
  assert.equal(first.project?.filePath, "[redacted path]");
  assert.deepEqual(first.selectedLayers.map((layer) => layer.id), ["layer-title"]);
  assert.equal(first.activeComposition?.id, "comp-main");
  assert.equal(first.selectionAncestors.length, 0);
  assert.equal(first.items.length, 0);
});

test("runChat exposes a typed response and phase logging without raw bodies", async () => {
  const provider = new MockProvider({ answer: "There is one selected text layer." });
  const events: DiagnosticEvent[] = [];
  const response = await runChat({
    schemaVersion: "0.1",
    requestId: "chat-1",
    message: "What is selected?",
    snapshot: representativeSnapshot,
  }, provider, { logger: { record: (event) => events.push(event) } });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  assert.equal(response.answer, "There is one selected text layer.");
  assert.deepEqual(response.diagnostics.phases, ["context-selection", "redaction", "provider-request", "provider-response"]);
  assert.equal(provider.lastInput?.context.project?.filePath, "[redacted path]");
  assert.deepEqual(events.map((event) => event.phase), response.diagnostics.phases);
  assert.equal(JSON.stringify(events).includes("/projects"), false);
});

test("diagnostic details and model output redact key-like values", async () => {
  const event = redactDiagnosticEvent({ phase: "provider-error", requestId: "diag-1", details: { detail: "Bearer super-secret-token", key: "sk-proj-123456789" } });
  assert.equal(JSON.stringify(event).includes("super-secret-token"), false);
  assert.equal(JSON.stringify(event).includes("sk-proj-123456789"), false);
  const response = await runChat({ schemaVersion: "0.1", requestId: "chat-secret", message: "hello", snapshot: representativeSnapshot }, new MockProvider({ answer: "The key is sk-proj-123456789" }));
  assert.equal(response.ok, true);
  if (response.ok) assert.equal(response.answer.includes("sk-proj-123456789"), false);
});

test("runChat reports the provider status and reason instead of a generic failure", async () => {
  const events: DiagnosticEvent[] = [];
  const response = await runChat({ schemaVersion: "0.1", requestId: "chat-401", message: "hello", snapshot: representativeSnapshot }, {
    id: "p",
    model: "m",
    config: { id: "p", endpoint: "https://x.test", model: "m", authSource: "server-environment" },
    displayMetadata: { id: "p", displayName: "P", endpoint: "https://x.test", model: "m", authSource: "server-environment", keyConfigured: true },
    complete: async () => { throw new ProviderHttpError(401, "The compatible API returned HTTP 401."); },
  }, { logger: { record: (event) => events.push(event) } });
  assert.equal(response.ok, false);
  if (response.ok) return;
  assert.match(response.error.message, /HTTP 401/);
  assert.equal(events.find((event) => event.phase === "provider-error")?.details.status, 401);
});
