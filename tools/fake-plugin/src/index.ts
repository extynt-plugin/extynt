// @extynt/fake-plugin: a scriptable stand-in for the extynt After Effects plugin.
export { startFakePlugin } from "./plugin.js";
export { chunked, hangUp, late, ok, raw, refuse, stall } from "./replies.js";
export type { HostMeta, Reply } from "./replies.js";
export { entry, initialWatchState, makeLayer, makeProject } from "./fixtures.js";
export type { FixtureComposition, FixtureEntry, FixtureLayer, FixtureProject } from "./fixtures.js";
export type { DropTarget, FakePlugin, FakePluginOptions, FakeRequest, FakeState, Handler, HostCallHandler } from "./types.js";
export { decodedValue, isWireArray, isWireObject, toWire, wireObject, wireObjectOfDocument, wireOfDocument, wireValue } from "./wire.js";
export type { WireObject, WireValue } from "./wire.js";
