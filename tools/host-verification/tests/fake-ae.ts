/**
 * The fake After Effects host, split along its seams under `tests/fake-host/`:
 *
 * - `property`   the property/value model and the child set each matchName materialises
 * - `keyframes`  the key list: normalised writes and interpolated sampling
 * - `layers`     layer/comp/project accessors, parenting compensation, content bounds
 * - `dispatch`   the `apply_plan` command table and its failure/refusal replies
 * - `extendscript` the JSON precision stage, enum holders, disk fakes and role table
 * - `host`       assembles the above into the `app`/`$`/context triple the probe sees
 */
export { FakeGradient, FakePropertyGroup, FakeProperty, walk } from "./fake-host/property.js";
export { FakeComp, FakeFolder, FakeLayer, FakeProject, FakeRenderQueue } from "./fake-host/layers.js";
export { FAKE_PRESET_PATH, FakeDiskFile, FakeDiskFolder, LAYER_ROLES, TRACK_MATTE_TYPE, reportPrecision, type FakeHost } from "./fake-host/extendscript.js";
export { createFakeHost } from "./fake-host/host.js";
