/** The main agent's per-step reasoning lands on disk as each step finishes, so a cancelled turn keeps it. */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeJson, object, string } from "@extynt/decode";
import { MockProvider } from "@extynt/llm";
import { runAgent } from "../src/agent-runtime.js";
import { AGENT_LOG_REASONING_CHARS, appendAgentStepLog, pruneStaleSidecarLogs } from "../src/server-agent-logs.js";

test("a step line keeps the last 16000 chars of reasoning, is mode 0600, and a bad directory never throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-log-"));
  const reasoning = `${"a".repeat(5_000)}${"z".repeat(AGENT_LOG_REASONING_CHARS)}`;
  appendAgentStepLog(dir, { requestId: "req-1", workflowId: "job/1", step: 1, at: "2026-01-01T00:00:00.000Z", reasoning, tools: ["t"], results: [{ name: "t", ok: true }] });
  const file = join(dir, "agent-logs", "job_1.jsonl");
  const row = decodeJson(readFileSync(file, "utf8").trim(), object({ schemaVersion: string(), reasoning: string() }));
  assert.ok(row.ok, "the line is JSON with its schema version and reasoning");
  assert.equal(row.value.schemaVersion, "extynt.agent-log/0.1");
  assert.equal(row.value.reasoning, "z".repeat(AGENT_LOG_REASONING_CHARS));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.doesNotThrow(() => appendAgentStepLog(join(file, "nope"), { requestId: "r", step: 1, at: "x", reasoning: "", tools: [], results: [] }));
});

test("onStepDone reports each finished step with its tools and ok/code results, and survives a cancel", async () => {
  const rows: Array<{ step: number; reasoning: string; tools: string[]; results: Array<{ name: string; ok: boolean; code?: string }> }> = [];
  const controller = new AbortController();
  let calls = 0;
  const provider = new MockProvider({ script: () => {
    calls += 1;
    return { text: "", toolCalls: [{ id: `c${calls}`, name: "ae_no_such_tool", arguments: {} }], raw: { role: "assistant", content: "", reasoning_content: `thought ${calls}` } };
  } });
  const result = await runAgent(provider, {
    requestId: "req-2", message: "go", history: [], briefing: "test", maxSteps: 3, signal: controller.signal,
    callTool: () => { if (calls >= 2) controller.abort(); return { ok: false, error: { code: "TOOL_NOT_AVAILABLE", message: "none" } }; },
    onStepDone: (row) => rows.push(row),
    providerName: { displayName: "mock", keyVariable: "MOCK" },
  });
  assert.ok(rows.length >= 1, "completed steps are reported");
  assert.equal(rows[0]?.step, 1);
  assert.equal(rows[0]?.reasoning, "thought 1");
  assert.deepEqual(rows[0]?.tools, ["ae_no_such_tool"]);
  assert.ok(result.reasoning.length >= rows.length);
});

test("startup prunes diagnostic logs older than 30 days, never follows a symlink, and leaves exports and chat logs alone", () => {
  const root = mkdtempSync(join(tmpdir(), "log-retention-"));
  const outside = mkdtempSync(join(tmpdir(), "log-retention-outside-"));
  const old = (path: string) => utimesSync(path, new Date(Date.now() - 40 * 86400_000), new Date(Date.now() - 40 * 86400_000));
  mkdirSync(join(root, "agent-logs"), { recursive: true });
  mkdirSync(join(root, "exports"), { recursive: true });
  mkdirSync(join(root, "chat-logs"), { recursive: true });
  const stale = join(root, "agent-logs", "old.jsonl"), fresh = join(root, "agent-logs", "new.jsonl");
  writeFileSync(stale, "{}\n"); old(stale);
  writeFileSync(fresh, "{}\n");
  const target = join(outside, "target.jsonl");
  writeFileSync(target, "{}\n"); old(target);
  symlinkSync(target, join(root, "agent-logs", "link.jsonl"));
  const pipeline = join(root, "pipeline.log");
  writeFileSync(pipeline, "{}\n"); old(pipeline);
  const exported = join(root, "exports", "chat.txt"), chatLog = join(root, "chat-logs", "s.jsonl");
  writeFileSync(exported, "kept"); old(exported);
  writeFileSync(chatLog, "{}\n"); old(chatLog);

  assert.equal(pruneStaleSidecarLogs(root), 2, "the stale agent log and pipeline.log are removed");
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(pipeline), false);
  assert.equal(existsSync(fresh), true, "a recent log stays");
  assert.equal(existsSync(target), true, "a symlink's target outside the folder is never followed");
  assert.equal(existsSync(exported), true, "exports are the user's and stay");
  assert.equal(existsSync(chatLog), true, "automatic chat logs are not part of this retention");
  assert.equal(pruneStaleSidecarLogs(join(root, "missing")), 0, "a missing state folder is not an error");
});
