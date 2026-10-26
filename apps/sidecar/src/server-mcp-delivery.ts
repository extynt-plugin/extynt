// The delivery of MCP tool work to the paired panel, composed from its parts: approvals, undo, frame captures and panel requests.
import { createApprovalDelivery, type ApprovalDeliveryCapability } from "./server-mcp-approval-delivery.js";
import { createCaptureDelivery, type CaptureDeliveryCapability } from "./server-mcp-capture.js";
import type { McpDeliveryDeps } from "./server-mcp-delivery-deps.js";
import { createPanelRequests, type PanelRequestCapability } from "./server-mcp-panel-requests.js";
import { createPlanDelivery, type PlanDeliveryCapability } from "./server-mcp-plan-delivery.js";

/** Everything the delivery offers the rest of the sidecar. */
export type McpDeliveryCapability = ApprovalDeliveryCapability & CaptureDeliveryCapability & PanelRequestCapability & PlanDeliveryCapability;

/** Builds the delivery over the sidecar state and the capabilities it reads. */
export function createMcpDelivery(deps: McpDeliveryDeps): McpDeliveryCapability {
  const capture = createCaptureDelivery(deps);
  return { ...createPlanDelivery(deps), ...createApprovalDelivery(deps), ...capture, ...createPanelRequests(deps, capture) };
}
