// How a native operation's fields are laid out in a plan operation: which nest under the target and which stay top-level.
import { object } from "./native-schema-kit.js";
import type { NativeInputSchema, NativeOperationDefinition } from "./native-operation-types.js";

const FLAT_PLAN_TYPES: ReadonlySet<string> = new Set(["create_composition", "create_folder", "import_file", "create_vector_artwork", "render_composition", "set_project_settings", "save_project", "collect_project", "switch_project", "cleanup_project"]);
const ITEM_TARGET_PLAN_TYPES: ReadonlySet<string> = new Set(["set_item_name", "move_item_to_folder", "delete_project_item", "replace_footage", "set_footage_proxy", "clear_footage_proxy", "set_footage_interpretation"]);
const CAPABILITY_DISCRIMINATORS: ReadonlySet<string> = new Set(["action"]);
const LAYER_TARGET_FIELDS: readonly string[] = ["compositionId", "layerId", "propertyPath", "effectPath"];
const ITEM_TARGET_FIELDS: readonly string[] = ["itemId"];
const PATH_PLACEMENT: Readonly<Record<string, Readonly<Record<string, "top" | "both">>>> = { set_layer_property: { propertyPath: "top" }, ensure_effect: { effectPath: "both" } };
const MINTED_LAYER_PLAN_TYPES: ReadonlySet<string> = new Set(["create_layer"]);
type InputProperty = NativeInputSchema["properties"][string];
type InputPropertyMap = Record<string, InputProperty>;
interface TargetLayout { nested: InputPropertyMap; repeated: readonly string[]; mintedLayer: boolean; hasTarget: boolean }

function planSchemaFields(base: NativeInputSchema): { properties: InputPropertyMap; required: readonly string[] } {
  const properties: InputPropertyMap = {};
  for (const [key, value] of Object.entries(base.properties)) if (!CAPABILITY_DISCRIMINATORS.has(key)) properties[key] = value;
  return { properties, required: base.required.filter((key) => !CAPABILITY_DISCRIMINATORS.has(key)) };
}

function targetFieldsOf(planType: string, placement: Readonly<Record<string, "top" | "both">>): readonly string[] {
  if (FLAT_PLAN_TYPES.has(planType)) return [];
  return ITEM_TARGET_PLAN_TYPES.has(planType) ? ITEM_TARGET_FIELDS : LAYER_TARGET_FIELDS.filter((key) => placement[key] !== "top");
}

function targetLayout(planType: string, properties: InputPropertyMap, required: readonly string[]): TargetLayout {
  const placement = PATH_PLACEMENT[planType] ?? {};
  const targetFields = targetFieldsOf(planType, placement);
  const nested: InputPropertyMap = {};
  const repeated: string[] = [];
  for (const key of targetFields) {
    const value = properties[key];
    if (!value) continue;
    nested[key] = value;
    if (placement[key] === "both") repeated.push(key);
    else delete properties[key];
  }
  const mintedLayer = MINTED_LAYER_PLAN_TYPES.has(planType) && !nested.layerId;
  if (mintedLayer) nested.layerId = { type: "string", description: "Required: the __new__: placeholder for the layer this operation creates." };
  return { nested, repeated, mintedLayer, hasTarget: Object.keys(nested).length > 0 };
}

function planShapeText(planType: string, layout: TargetLayout, requiredInTarget: readonly string[]): string {
  const names = Object.keys(layout.nested).join(", ");
  const optionalInTarget = Object.keys(layout.nested).filter((key) => !requiredInTarget.includes(key));
  const where = layout.hasTarget
    ? `Its target is {${names}}${optionalInTarget.length ? ` (${requiredInTarget.join(", ")} required)` : ""} and every other field is top-level.`
    : "It takes no target: every field is top-level.";
  const both = layout.repeated.length ? ` ${layout.repeated.join(", ")} must appear in both places — inside target and at the top level — and the two must match.` : "";
  return `A plan operation with type:"${planType}". ${where} A plan operation never carries a capability discriminator such as "action" — type already selects it. Only the fields listed here are accepted: an unknown field is refused, and a field belongs in one place only unless this says otherwise.${both}`;
}

/** What a model must write to put this operation in a plan: the plan-type fields, where they nest, and the shape sentence. */
export function planOperationDescription(entry: NativeOperationDefinition, planType: string): { inputSchema: NativeInputSchema; planShape: string } {
  const base = entry.planSchemas?.[planType] ?? entry.inputSchema;
  const { properties, required } = planSchemaFields(base);
  const layout = targetLayout(planType, properties, required);
  const topRequired = required.filter((key) => !(key in layout.nested));
  const inputSchema = layout.hasTarget
    ? object([...topRequired, "target"], { ...properties, target: { type: "object", description: `The operation target. Write ${Object.keys(layout.nested).join(", ")} here, not at the top level.${layout.repeated.length ? ` ${layout.repeated.join(", ")} must also appear at the top level and match.` : ""}` } })
    : object([...topRequired], properties);
  const requiredInTarget = Object.keys(layout.nested).filter((key) => (key === "layerId" && layout.mintedLayer) || required.includes(key));
  return { inputSchema, planShape: planShapeText(planType, layout, requiredInTarget) };
}
