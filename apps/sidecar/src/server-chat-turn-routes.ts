// The POST /v1/chat route: the door a panel message comes through. It decodes the request, prepares and admits the turn, runs it and answers with the turn's reply.
import { DEFAULT_MAX_BODY_BYTES } from "./server-limits.js";
import { admitChatTurn } from "./server-chat-admission.js";
import { prepareChat } from "./server-chat-prepare.js";
import { chatRequest, type ChatInput } from "./server-chat-request.js";
import { executeChatTurn, finishChatTurn, type ChatReplyBody } from "./server-chat-turn-run.js";
import { translatorOf } from "./ui-language.js";
import { inRequestScope } from "./request-scope.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { jsonBody, type BodySpec, type Refusal } from "./server-route-body.js";
import { bodyRoute, type MountedRoute, type RouteCall, type RouteReply } from "./server-route-table.js";
import { REFERENCE_BODY_BYTES } from "./workflow-references.js";

function requireProvider(deps: HttpRoutesDeps): Refusal | null {
  const t = translatorOf(deps.state);
  return deps.state.chatProvider ? null : { status: 503, code: "LLM_NOT_CONFIGURED", message: t("failure.chat.notConfigured") };
}

function chatBody(deps: HttpRoutesDeps): BodySpec<ChatInput> {
  const limitBytes = deps.state.maxBodyBytes >= DEFAULT_MAX_BODY_BYTES ? REFERENCE_BODY_BYTES : deps.state.maxBodyBytes;
  const t = translatorOf(deps.state);
  const invalid: Refusal = { status: 422, code: "INVALID_CHAT_REQUEST", message: t("failure.chat.invalid") };
  const tooLarge: Refusal = { status: 413, code: "BODY_LIMIT", message: t("failure.chat.tooLarge") };
  const notJson: Refusal = { status: 400, code: "INVALID_JSON", message: t("failure.chat.notJson") };
  return jsonBody(chatRequest, limitBytes, invalid, { tooLarge, notJson });
}

async function takeChatTurn({ deps, request, response, context, body: input }: RouteCall<ChatInput>): Promise<RouteReply<ChatReplyBody>> {
  const preparation = await prepareChat(deps.state, request, input);
  if (preparation.kind === "refusal") return preparation;
  context.requestId = input.requestId;
  const admission = await admitChatTurn(deps, input.requestId, response);
  if (admission.kind === "refusal") return admission;
  deps.state.chatProjectLinks.begin(input.requestId);
  try {
    return await inRequestScope(input.requestId, () => executeChatTurn(deps, preparation.chat, admission.active.turn));
  } finally {
    finishChatTurn(deps.state, deps.dispatch, input.requestId, admission.active);
  }
}

/**
 * The chat turn route. It refuses with LLM_NOT_CONFIGURED before reading the body when no provider is configured. The
 * body may be as large as a message with its reference images, unless the operator set a lower limit.
 */
export const chatTurnRoutes: readonly MountedRoute[] = [
  bodyRoute({ method: "POST", path: "/v1/chat", guard: requireProvider, body: chatBody, handle: takeChatTurn }),
];
