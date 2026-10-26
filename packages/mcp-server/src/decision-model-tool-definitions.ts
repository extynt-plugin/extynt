// The decision-model tool: status, a one-time link for the user to paste a key into, removal and a live test. It has no key argument on purpose.
import { enumArg, optionalArg } from "./arg.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

const AE_DECISION_MODEL = defineTool("ae_decision_model", {
  description: "Set up, check or remove the optional decision model (Jev, an OpenAI-compatible server or Cloudflare Workers AI) that answers short closed questions for extynt. status lists models, never keys; setup returns a one-time link where the USER pastes their key; clear removes a provider; test asks one tiny question. NEVER ask for a key in chat or pass one to any tool; if the user pastes one, tell them to use the setup link and do not repeat it. After setup say: \"Open this link to paste your key; it's stored only on this computer.\"",
  access: "note",
  input: {
    action: enumArg(["status", "setup", "clear", "test"], { description: "status, setup (returns the key-entry link), clear or test." }),
    provider: optionalArg(enumArg(["jev", "openai", "cloudflare", "systemone"], { description: "Which provider setup preselects, or which one clear and test act on. Omit for all providers (clear) or the first model (test)." })),
  },
});

/** The decision-model tool. */
export const DECISION_MODEL_TOOLS = [AE_DECISION_MODEL] satisfies ReadonlyArray<ToolEntry>;
