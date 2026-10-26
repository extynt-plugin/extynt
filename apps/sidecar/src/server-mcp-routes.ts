// The routes of the MCP bridge: the tool list, a tool call and the panel's frame capture receipt.
import { listTools } from "@extynt/mcp-server";

import { mcpInput } from "./server-mcp-arguments.js";
import { captureReceipt } from "./server-mcp-capture-receipt.js";
import { jsonBody } from "./server-route-body.js";
import { outcomeReply } from "./server-route-outcome.js";
import { STREAMED, bodyRoute, ok, route, type MountedRoute } from "./server-route-table.js";

const TOOL_CALL_LIMIT_BYTES = 512_000;
const CAPTURE_LIMIT_BYTES = 3_200_000;

const INVALID_TOOL_REQUEST = { status: 422, code: "INVALID_TOOL_REQUEST", message: "Tool requests require a name." } as const;
const INVALID_CAPTURE = { status: 422, code: "INVALID_CAPTURE_RECEIPT", message: "Capture receipt was not understood." } as const;

/** `GET /v1/mcp/tools`, `POST /v1/mcp/tools/call` and `POST /v1/captures`. */
export const mcpRoutes: readonly MountedRoute[] = [
  route({ method: "GET", path: "/v1/mcp/tools", handle: () => ok({ ok: true, tools: listTools() }) }),
  bodyRoute({
    method: "POST",
    path: "/v1/mcp/tools/call",
    body: (deps) =>
      jsonBody(mcpInput, Math.min(deps.state.maxBodyBytes, TOOL_CALL_LIMIT_BYTES), INVALID_TOOL_REQUEST, {
        tooLarge: { status: 413, code: "BODY_LIMIT", message: "Tool request exceeded the limit." },
        notJson: { status: 400, code: "INVALID_JSON", message: "Tool request must be valid JSON." },
      }),
    handle: async ({ deps, body, request, response, context }) => {
      await deps.dispatch.callMcpTool(body, { request, response, context });
      return STREAMED;
    },
  }),
  bodyRoute({
    method: "POST",
    path: "/v1/captures",
    body: (deps) =>
      jsonBody(captureReceipt, Math.min(deps.state.maxBodyBytes, CAPTURE_LIMIT_BYTES), INVALID_CAPTURE, {
        tooLarge: { status: 413, code: "BODY_LIMIT", message: "Capture preview exceeded its declared bound." },
        notJson: { status: 400, code: "INVALID_JSON", message: "Capture receipt must be valid JSON." },
      }),
    handle: ({ deps, body }) => outcomeReply(deps.dispatch.settleCapture(body)),
  }),
];
