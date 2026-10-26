/** The one "Details" disclosure under an answer: the model's reasoning, the tools it used (with error codes) and what the turn cost. */
import { el } from "./panel-dom.js";
import { formatCacheHitPercent, formatExactTokens, formatTokens } from "./panel-chat-text.js";
import { t } from "./panel-language.js";
import type { ChatTool, ReasoningStep, TokenUsage } from "./transcript.js";

function section(title: string): HTMLElement {
  const box = el("div", "answer-details-section");
  box.appendChild(el("div", "answer-details-title", title));
  return box;
}

function reasoningSection(steps: ReadonlyArray<ReasoningStep>): HTMLElement {
  const box = section(t("plans.details.reasoning"));
  steps.forEach((entry) => {
    const row = el("div", "saved-reasoning-step");
    const tools = entry.tools.length ? " · " + entry.tools.join(", ") : "";
    row.appendChild(el("div", "saved-reasoning-label", t("plans.details.step", { step: String(entry.step || "?") }) + tools));
    row.appendChild(el("div", "saved-reasoning-text", entry.text));
    box.appendChild(row);
  });
  return box;
}

function toolLine(tool: ChatTool): string {
  if (tool.ok) return tool.name;
  return t("plans.details.refused", { name: tool.name, code: tool.code || "error" }) + (tool.message ? " " + tool.message : "");
}

function toolsSection(tools: ReadonlyArray<ChatTool>): HTMLElement {
  const box = section(t("plans.details.tools"));
  const list = el("ul", "trace");
  tools.forEach((tool) => list.appendChild(el("li", tool.ok ? "" : "bad", toolLine(tool))));
  box.appendChild(list);
  return box;
}

function usageSection(usage: TokenUsage, provider: string | undefined): HTMLElement {
  const hit = formatCacheHitPercent(usage.cachedInputTokens, usage.inputTokens);
  const parts = [
    provider ?? "",
    t("plans.details.tokens", { tokens: formatTokens(usage.totalTokens) }),
    hit === null ? "" : t("plans.details.cacheHit", { percent: hit }),
    t("plans.details.output", { tokens: formatExactTokens(usage.outputTokens) }),
  ];
  const box = section(t("plans.details.usage"));
  box.appendChild(document.createTextNode(parts.filter(Boolean).join(" · ")));
  return box;
}

interface DetailsSource {
  readonly tools?: ReadonlyArray<ChatTool> | undefined;
  readonly reasoning?: ReadonlyArray<ReasoningStep> | undefined;
  readonly usage?: TokenUsage | undefined;
  readonly provider?: string | undefined;
}

function reasoningOf(source: DetailsSource): HTMLElement | null {
  return source.reasoning?.length ? reasoningSection(source.reasoning) : null;
}

function toolsOf(source: DetailsSource): HTMLElement | null {
  return source.tools?.length ? toolsSection(source.tools) : null;
}

function usageOf(source: DetailsSource): HTMLElement | null {
  return source.usage ? usageSection(source.usage, source.provider) : null;
}

/** The disclosure, or null when the answer has nothing to disclose. */
export function answerDetails(source: DetailsSource): HTMLElement | null {
  const sections = [reasoningOf(source), toolsOf(source), usageOf(source)].filter((node): node is HTMLElement => node !== null);
  if (sections.length === 0) return null;
  const details = el("details", "answer-details");
  details.appendChild(el("summary", "", t("plans.details.title")));
  sections.forEach((node) => details.appendChild(node));
  return details;
}
