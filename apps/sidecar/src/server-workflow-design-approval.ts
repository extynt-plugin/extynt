// The design approval step. A job that draws new artwork, for a request that asks to see the design first or to wait for a go-ahead, stops at a design brief the user approves before anything is built, whether or not the model chooses to ask.
import { approvalFirstLanguage, type RequestLanguage } from "@extynt/decide";
import { askUserTool } from "./server-workflow-ask.js";
import type { ToolArguments } from "./agent-types.js";
import { WORKFLOW_SPECIALIST_TOOL } from "./agent-types.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { authoringOperations, createsDrawnArtwork, jobHasDesign } from "./server-workflow-design.js";
import type { ToolResult } from "./server-workflow-operation-json.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

type Call = { readonly name: string; readonly args: ToolArguments };

const GOAL_CHARS = 400;

function launchesDesigner(call: Call): boolean {
  return call.name === WORKFLOW_SPECIALIST_TOOL && call.args.role === "visual-scene" && call.args.action === "launch";
}

function startsDesign(deps: ChatAgentDeps, call: Call, input: ChatAgentInput): boolean {
  if (launchesDesigner(call)) return true;
  return createsDrawnArtwork(authoringOperations(call.name, call.args)) && !jobHasDesign(deps, input);
}

function requestText(input: ChatAgentInput): string {
  return input.workflowGoalSummary ?? input.message;
}

function applies(deps: ChatAgentDeps, input: ChatAgentInput): boolean {
  const owner = input.workflowRole === WORKFLOW_OWNER && !!input.workflowJobId && (input.workflowCycle ?? 0) === 0;
  return owner && deps.state.options.workflowDesignApproval === true && approvalFirstLanguage(requestText(input)) !== undefined;
}

const BRIEF_FRAME: Readonly<Record<RequestLanguage, (goal: string) => string>> = {
  en: (goal) => `Here is the design I will build:\n${goal}\nI will draw each part as its own editable layer in the open composition, then animate it as asked.\nReply Build it to start, or tell me what to change.`,
  es: (goal) => `Este es el diseño que voy a construir:\n${goal}\nDibujaré cada parte como una capa editable en la composición abierta y luego la animaré como pediste.\nResponde Construir para empezar, o dime qué cambiar.`,
  de: (goal) => `So sieht der Entwurf aus, den ich bauen werde:\n${goal}\nIch zeichne jeden Teil als eigene, bearbeitbare Ebene in der geöffneten Komposition und animiere ihn dann wie gewünscht.\nAntworte mit Bauen, um zu starten, oder sag mir, was ich ändern soll.`,
  fr: (goal) => `Voici le design que je vais construire :\n${goal}\nJe dessinerai chaque partie sur son propre calque modifiable dans la composition ouverte, puis je l'animerai comme demandé.\nRéponds Construire pour commencer, ou dis-moi quoi changer.`,
  ja: (goal) => `これから作るデザインです:\n${goal}\n開いているコンポジションに、各パーツを編集できる個別のレイヤーとして描き、そのあと依頼どおりにアニメーションを付けます。\n始めるには「作成して」と返信してください。変更したい点があれば教えてください。`,
  "zh-Hans": (goal) => `这是我将要构建的设计:\n${goal}\n我会在当前合成中把每个部分画成独立、可编辑的图层，然后按你的要求添加动画。\n回复“开始构建”即可开始，或告诉我要修改的地方。`,
};

function composedBrief(input: ChatAgentInput): string {
  const goal = requestText(input).trim().slice(0, GOAL_CHARS);
  return BRIEF_FRAME[approvalFirstLanguage(requestText(input)) ?? "en"](goal);
}

function briefRefusal(): ToolResult {
  return { ok: false, error: { code: "DESIGN_APPROVAL_REQUIRED", message: "The user approves the design before anything is drawn or built, and nothing from this call was queued or launched. Call ae_ask_user with kind design-brief now: in the user's own language, a few short plain lines, one per part, saying what you will draw, its colours and how it will move, ending with a question asking whether to build it. Your turn ends there; their reply opens the build." } };
}

/** Holds the call that would start a design until the user approved a design brief: the first time the model is told to write one with ae_ask_user, after that the sidecar sends one from the request itself. */
export function designApprovalGate(deps: ChatAgentDeps, call: Call, input: ChatAgentInput): ToolResult | undefined {
  if (!applies(deps, input) || !startsDesign(deps, call, input)) return undefined;
  const jobId = deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId ?? "");
  const seen = deps.state.designApprovals.get(jobId);
  if (seen === "approved") return undefined;
  if (seen === undefined) {
    deps.state.designApprovals.set(jobId, "requested");
    return briefRefusal();
  }
  return askUserTool(deps, { question: composedBrief(input), kind: "design-brief" }, input);
}
