/**
 * Tests that the unused-locals pass reads tsc output into per-area declarations, and fails only areas that are already clean.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { countsByArea, unusedDeclarations, unusedLocalVerdict } from '../scripts/lib/unused-locals.ts';

interface UnusedEntry {
  readonly area: string;
  readonly line: number;
}

const OUTPUT = [
  "apps/sidecar/src/a.ts(3,10): error TS6133: 'x' is declared but its value is never read.",
  "tools/fake-plugin/src/b.ts(8,1): error TS6192: All imports in import declaration are unused.",
  "apps/sidecar/src/c.ts(1,1): error TS2322: Type 'a' is not assignable to type 'b'.",
  "apps/sidecar/src/d.ts(2,5): error TS6196: 'T' is declared but never used.",
].join('\n');

test('unusedDeclarations keeps only the unused-declaration codes', () => {
  const found = unusedDeclarations(OUTPUT);
  assert.deepEqual(found.map((entry: UnusedEntry) => `${entry.area}:${entry.line}`), ['apps/sidecar:3', 'tools/fake-plugin:8', 'apps/sidecar:2']);
});

test('countsByArea orders areas by descending count', () => {
  assert.deepEqual(countsByArea(unusedDeclarations(OUTPUT)), [{ area: 'apps/sidecar', count: 2 }, { area: 'tools/fake-plugin', count: 1 }]);
});

test('unusedLocalVerdict fails clean areas and only reports the rest', () => {
  const { failures, summary } = unusedLocalVerdict(unusedDeclarations(OUTPUT), new Set(['tools/fake-plugin']));
  assert.equal(failures.length, 1);
  assert.match(failures[0] ?? "", /^tools\/fake-plugin\/src\/b\.ts:8:/);
  assert.equal(summary, 'unused locals (warning): apps/sidecar=2');
});
