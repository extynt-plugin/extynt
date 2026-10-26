// How a tool is declared: its words, what it may change and its arguments in one place, from which the advertised definition and the argument decoder both come.
import { toolInput } from "./arg.js";
import type { ArgShape, ToolInput } from "./arg.js";
import type { ToolAnnotations, ToolDefinition } from "./contracts.js";

type ToolAccess = "read" | "write" | "note";

interface ToolSpec<S extends ArgShape> {
  readonly description: string;
  readonly access?: ToolAccess;
  readonly planCard?: true;
  readonly input: S;
}

/** A declared tool: the definition clients are shown and the input that decodes its arguments. */
export interface ToolEntry<S extends ArgShape = ArgShape, N extends string = string> {
  readonly name: N;
  readonly definition: ToolDefinition;
  readonly input: ToolInput<S>;
}

const ANNOTATIONS: Readonly<Record<ToolAccess, ToolAnnotations>> = {
  read: { readOnlyHint: true, openWorldHint: false },
  write: { destructiveHint: true, openWorldHint: false },
  note: { destructiveHint: false, openWorldHint: false },
};

/** Declares a tool; its advertised schema and its argument decoder are built from the same argument shape. */
export function defineTool<const N extends string, S extends ArgShape>(name: N, spec: ToolSpec<S>): ToolEntry<S, N> {
  const input = toolInput(spec.input);
  const definition: ToolDefinition = {
    name,
    description: spec.description,
    inputSchema: input.schema,
    annotations: ANNOTATIONS[spec.access ?? "read"],
    ...(spec.planCard === true ? { planCard: true as const } : {}),
  };
  return { name, definition, input };
}
