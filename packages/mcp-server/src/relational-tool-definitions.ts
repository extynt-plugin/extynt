// The relational-graph tools: bounded queries over typed effect definitions, parameter facts and linked control instances.
import { constArg, numberArg, objectArg, optionalArg, stringArg, unionArg } from "./arg.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

const ID = stringArg({ minLength: 1, maxLength: 256 });
const OPTIONAL_ID = optionalArg(ID);
const ORDINAL = numberArg({ integer: true, min: 1 });
const OPTIONAL_ORDINAL = optionalArg(ORDINAL);
const PAGE_LIMIT = optionalArg(numberArg({ integer: true, min: 1, max: 25 }));
const PAGE = { cursor: OPTIONAL_ID, limit: PAGE_LIMIT };
const WAIT = optionalArg(numberArg({ min: 0, max: 60, description: "Transport wait budget; these SQL/proposal calls do not start native dispatch." }));

const AE_QUERY_RELATIONAL_GRAPH = defineTool("ae_query_relational_graph", {
  description: "Query bounded typed effect definitions, parameter facts, linked current control instances, coverage or separate desired requests in the current .extynt project. Definitions retain native or documented provenance; missing meaning, defaults and units remain unknown. Current rows include exact observation IDs and stale/unknown state. Empty coverage never proves absence. SQL observations do not authorize AE writes.",
  input: {
    query: unionArg([
      objectArg({
        kind: constArg("effect-definitions"),
        hostKey: ID,
        matchName: OPTIONAL_ID,
        ...PAGE,
      }),
      objectArg({
        kind: constArg("parameter-definitions"),
        effectDefinitionId: ID,
        ...PAGE,
      }),
      objectArg({
        kind: constArg("parameter-facts"),
        parameterDefinitionId: ID,
        ...PAGE,
      }),
      objectArg({
        kind: constArg("controls"),
        compositionId: ID,
        layerId: ID,
        effectMatchName: OPTIONAL_ID,
        effectIndex: OPTIONAL_ORDINAL,
        controlMatchName: OPTIONAL_ID,
        ...PAGE,
      }),
      objectArg({
        kind: constArg("coverage"),
        compositionId: ID,
        layerId: ID,
      }),
      objectArg({
        kind: constArg("desired-requests"),
        controlInstanceId: ORDINAL,
        ...PAGE,
      }),
    ]),
    waitSeconds: WAIT,
  },
});

const AE_DESCRIBE_CONTROL = defineTool("ae_describe_control", {
  description: "Read a bounded page of definition evidence for one exact parameterDefinitionId. Authored meaning/defaults and instance-specific native facts retain separate provenance. Unknown fields remain unknown; native name/type/min/max never imply plugin semantics. Continue using the returned cursor.",
  input: {
    parameterDefinitionId: ID,
    ...PAGE,
    waitSeconds: WAIT,
  },
});

const AE_PREPARE_PARAMETER_CHANGE = defineTool("ae_prepare_parameter_change", {
  description: "Prepare one approval-required parameter assignment using exact controlInstanceId and current observationId. The sidecar resolves the native address and validates current scoped host evidence. This adapter supports only local static Gaussian Blurriness; other controls, expressions, animation and semantic conversions are explicitly refused. value is one finite native number; optional unit must exactly match known current native spelling. External clients receive a proposed plan to approve; the panel agent stages one typed operation and must finish its existing queue. Desired data stays separate until confirmed native readback.",
  access: "write",
  planCard: true,
  input: {
    controlInstanceId: ORDINAL,
    observationId: stringArg({ minLength: 1, maxLength: 128 }),
    value: objectArg({
      kind: constArg("number"),
      value: numberArg(),
      unit: optionalArg(stringArg({ minLength: 1, maxLength: 64 })),
    }),
    summary: optionalArg(stringArg({ minLength: 1, maxLength: 512 })),
    waitSeconds: WAIT,
  },
});

/** The relational-graph tools: bounded queries over typed effect definitions, parameter facts and linked control instances. */
export const RELATIONAL_TOOLS = [
  AE_QUERY_RELATIONAL_GRAPH,
  AE_DESCRIBE_CONTROL,
  AE_PREPARE_PARAMETER_CHANGE,
] satisfies ReadonlyArray<ToolEntry>;
