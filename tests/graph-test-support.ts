/** Fixtures shared by the graph store tests: the index target, a saved project identity, an item row, a census and a preset scan. */
import type { PresetInventory } from '../packages/capability-catalogue/dist/src/index.js';
import { isJsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import type { HostCensus } from '../apps/sidecar/dist/src/server-types.js';

export const indexTarget: JsonObject = { kind: 'index' };

export const identity: JsonObject = {
  project: { name: 'Saved.aep', filePath: '/synthetic/Saved.aep' },
  runtime: { appVersion: '26.2', platform: 'macOS' },
};

/** A composition row as the host reports it in an index page. */
export function item(id: number, name = `Comp ${id}`): JsonObject {
  return { id: String(id), name, itemIndex: id, type: 'composition', parentFolderId: '0', layers: 1 };
}

/** The value as a JSON object; anything else is a test mistake and throws. */
export function objectOf(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new Error('expected a JSON object');
  return value;
}

/** A census naming one installed Vendor effect, complete enough to be recorded. */
export function sampleCensus(): HostCensus {
  const runtime = { application: 'After Effects', appVersion: '26.2', buildNumber: null, buildName: null, platform: 'macOS', architecture: 'arm64', compatible: true } as const;
  const installedEffects = [{ matchName: 'Vendor Effect', displayName: 'Effect', category: 'Vendor', version: '1.2', available: true }];
  return { schemaVersion: '0.1', ok: true, requestId: 'census', warnings: [], result: { runtime, installedEffects, totalReported: 1, returnedCount: 1, completeness: 'partial' } };
}

/** A truncated scan that found one user preset. */
export function samplePresets(): PresetInventory {
  const items = [{ id: 'preset-1', name: 'Preset', category: 'User', root: 'user-presets', statFingerprint: 'fingerprint' }] as const;
  return { items: [...items], truncated: true, fingerprint: 'scan', scannedAt: '2026-10-01T00:00:00.000Z' };
}
