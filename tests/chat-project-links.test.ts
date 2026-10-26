/** Tests how a chat turn links to projects from returned observations, and the bounds on that memory. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatProjectLinks } from '../apps/sidecar/dist/src/chat-project-links.js';
import type { ToolResult } from '../apps/sidecar/dist/src/agent-types.js';
import { projectFileLink } from '../apps/sidecar/dist/src/project-file-names.js';
import type { ProjectFileLink } from '../apps/sidecar/dist/src/project-file-names.js';

const a = projectFileLink('saved', 'a'.repeat(64));
const b = projectFileLink('saved', 'b'.repeat(64));
const observed = (link: ProjectFileLink): ToolResult => ({ ok: true, data: jsonOf({ state: 'observed', storage: { projectLink: link } }) });

test('turn links follow returned observations, retain switches and never infer an active project', () => {
  const links = new ChatProjectLinks();
  links.begin('chat-1'); links.begin('chat-2');
  links.record('chat-1', observed(a)); links.record('chat-2', observed(a));
  links.record('chat-1', observed(b));
  assert.deepEqual(links.links('chat-1'), [a, b]);
  assert.deepEqual(links.links('chat-2'), [a]);
  links.begin('unobserved');
  assert.deepEqual(links.links('unobserved'), []);
  links.record('unobserved', { ok: true, data: jsonOf({ state: 'pending', storage: { projectLink: a } }) });
  links.record('unobserved', { ok: true, data: jsonOf({ state: 'observed', invalidated: true, storage: { projectLink: a } }) });
  links.record('unobserved', { ok: false, data: jsonOf({ state: 'observed', storage: { projectLink: a } }) });
  links.record('unobserved', observed({ ...a, chatLogFile: '../unrelated.jsonl' }));
  assert.deepEqual(links.links('unobserved'), []);
  links.record('chat-2', { ok: true, data: jsonOf({ state: 'retained', storage: { projectLink: b } }) });
  assert.deepEqual(links.links('chat-2'), [a, b]);
  links.begin('chat-1'); assert.deepEqual(links.links('chat-1'), []);
});

test('project link memory is bounded per turn and across abandoned turns', () => {
  const links = new ChatProjectLinks(); links.begin('old');
  for (let i = 0; i < 20; i++) links.record('old', observed(projectFileLink('saved', i.toString(16).padStart(64, '0'))));
  assert.equal(links.links('old').length, 16);
  for (let i = 0; i < 33; i++) links.begin(`request-${i}`);
  assert.deepEqual(links.links('old'), []);
  links.record('old', observed(a)); assert.deepEqual(links.links('old'), []);
});
