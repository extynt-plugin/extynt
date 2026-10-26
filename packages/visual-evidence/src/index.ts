// The public surface of local visual evidence: bounded capture requests that never leave this computer, and frame summaries that stand in for frame bytes.
export { compileCaptureCommand, validateCaptureRequest, type CaptureCommand, type CaptureReceipt, type CaptureRequest } from "./capture.js";
export { compareFrameSummaries, type FrameChange } from "./compare.js";
export type { FrameSummary, FrameSummaryOptions } from "./frame-types.js";
export { summarizeFrame } from "./summarize.js";
export { validateFrameSummary } from "./summary-validation.js";
export type { WireValue } from "./wire.js";
