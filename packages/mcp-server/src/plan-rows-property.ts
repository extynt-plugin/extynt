// Value rows for operations on properties, effects, expressions and text: the rows that carry a before and an after.
import { asObject, stringAt } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { boundedExpressionSource } from "./plan-card-lines.js";
import { EXPRESSION_CARD_SOURCE_CHARS } from "./core-constants.js";
import { fieldsOf, fixed, propertyBefore, propertyOf, rememberWrite, text, type PlainRowKey, type RowBuilder, type RowInput, type RowParts } from "./plan-row-context.js";
import { clipText, describeFields, formatKeys, formatValue, humanizeName } from "./plan-row-format.js";
import { effectLabel, propertyLabel } from "./plan-row-names.js";

function pathOf({ op, ref }: RowInput): string | undefined {
  return text(ref.propertyPath) ?? text(op.propertyPath);
}

function isColour(input: RowInput, path: string | undefined): boolean {
  return propertyOf(input.layer, path)?.valueType === "color" || /colou?r/i.test(path ?? text(input.op.role) ?? "");
}

function written(input: RowInput, path: string | undefined, label: string, after: string | null): RowParts {
  const before = propertyBefore(input, path);
  rememberWrite(input, path, after);
  return { label, before, after };
}

function valueOf(input: RowInput, value: JsonValue | undefined, colour = false): string | null {
  return formatValue(value, colour, input.state.translate);
}

function propertyName(input: RowInput): string {
  return propertyLabel(input.layer, pathOf(input), text(input.op.role), input.state);
}

function setLayerProperty(input: RowInput): RowParts {
  const path = pathOf(input);
  return written(input, path, propertyName(input), valueOf(input, input.op.value, isColour(input, path)));
}

function expressionAfter(input: RowInput, source: string): string {
  return input.state.translate("plan.row.expressionAfter", { source: boundedExpressionSource(source, EXPRESSION_CARD_SOURCE_CHARS) });
}

function animationRow(input: RowInput, name: string): RowParts {
  const { translate } = input.state;
  const keys = Array.isArray(input.op.keyframes) ? input.op.keyframes.length : 0;
  const source = text(fieldsOf(input.op.expression).source);
  const path = pathOf(input);
  if (keys > 0) return written(input, path, translate("plan.row.addKeyframes", { name }), formatKeys(keys, translate));
  if (source) return written(input, path, translate("plan.row.setExpression", { name }), expressionAfter(input, source));
  return written(input, path, translate("plan.row.animate", { name }), null);
}

function animateProperty(input: RowInput): RowParts {
  return animationRow(input, propertyName(input));
}

function controlName(input: RowInput): string {
  const effect = effectLabel(input.layer, text(input.ref.effectPath), text(input.op.effectMatchName), input.state);
  return input.state.translate("plan.row.controlOf", { control: propertyName(input), effect });
}

function animateControl(input: RowInput): RowParts {
  return animationRow(input, controlName(input));
}

function setEffectControl(input: RowInput): RowParts {
  const path = pathOf(input);
  return written(input, path, controlName(input), valueOf(input, input.op.value, isColour(input, path)));
}

const GAUSSIAN_DIMENSIONS: Record<number, PlainRowKey> = { 1: "plan.row.bothDirections", 2: "plan.row.horizontalOnly", 3: "plan.row.verticalOnly" };

function gaussianInitialization(init: JsonObject, input: RowInput): string | null {
  const direction = typeof init.dimensions === "number" ? GAUSSIAN_DIMENSIONS[init.dimensions] : undefined;
  if (typeof init.blurriness !== "number" || !direction || typeof init.repeatEdgePixels !== "boolean") return null;
  const { translate } = input.state;
  return translate("plan.row.blurSettings", { blurriness: valueOf(input, init.blurriness) ?? "", direction: translate(direction), edges: translate(init.repeatEdgePixels ? "plan.row.edgesRepeated" : "plan.row.edgesNotRepeated") });
}

function ensureEffect(input: RowInput): RowParts {
  const { translate } = input.state;
  const name = effectLabel(input.layer, text(input.op.effectPath), text(input.op.effectMatchName), input.state);
  const init = fieldsOf(input.op.initialization);
  const settings = gaussianInitialization(init, input) ?? (Object.keys(init).length ? describeFields(init, 6, translate) : null);
  const enabled = typeof input.op.enabled === "boolean" ? translate(input.op.enabled ? "plan.row.enabled" : "plan.row.disabled") : null;
  return { label: translate("plan.row.addEffect", { name }), before: null, after: [enabled, settings].filter((part) => part !== null).join(", ") || null };
}

function presetName(presetId: string | undefined, input: RowInput): string {
  const leaf = (presetId ?? "").split(/[/:\\]/).at(-1) ?? "";
  return clipText(leaf.replace(/\.ffx$/i, "")) || input.state.translate("plan.row.presetDefault");
}

function setExpression(input: RowInput): RowParts {
  const { translate } = input.state;
  const path = pathOf(input);
  const name = propertyName(input);
  const source = text(input.op.source);
  const before = clipText(propertyOf(input.layer, path)?.expression ?? "") || null;
  if (!source || input.op.enabled === false) return { label: translate("plan.row.clearExpression", { name }), before, after: null };
  return { label: translate("plan.row.setExpression", { name }), before, after: expressionAfter(input, source) };
}

const NON_STYLE_FIELDS: ReadonlySet<string> = new Set(["type", "target", "characterRanges", "text"]);

function setText(input: RowInput): RowParts {
  const { translate } = input.state;
  const content = input.op.text;
  if (typeof content === "string") {
    const read = propertyOf(input.layer, "ADBE Text Properties/ADBE Text Document")?.value;
    return { label: translate("plan.row.setText"), before: valueOf(input, read), after: valueOf(input, content) };
  }
  const style = Object.fromEntries(Object.entries(input.op).filter(([key]) => !NON_STYLE_FIELDS.has(key)));
  const font = text(style.font);
  if (font && Object.keys(style).length === 1) return { label: translate("plan.row.setFont"), after: input.state.fontNames.get(font) ?? font };
  return { label: translate("plan.row.restyleText"), after: describeFields(style, 3, translate) };
}

function textAnimator(label: "plan.row.addTextAnimator" | "plan.row.changeTextAnimator"): RowBuilder {
  return (input) => ({ label: input.state.translate(label), after: describeFields(fieldsOf(input.op.properties), 3, input.state.translate) });
}

function loopKeyframes(input: RowInput): RowParts {
  const mode = text(input.op.mode);
  const name = propertyLabel(input.layer, pathOf(input), undefined, input.state);
  return { label: input.state.translate("plan.row.loopKeyframes", { name }), after: mode ? humanizeName(mode) : null };
}

function textOnPath({ op, state }: RowInput): RowParts {
  const mask = typeof op.maskIndex === "number" ? (op.maskIndex === 0 ? state.translate("plan.row.detach") : state.translate("plan.row.maskIndex", { index: op.maskIndex })) : null;
  return { label: state.translate("plan.row.textOnPath"), after: mask };
}

function resizeSolid({ op, state }: RowInput): RowParts {
  return { label: state.translate("plan.row.resizeSolid"), after: [op.width, op.height].every((v) => typeof v === "number") ? `${String(op.width)}×${String(op.height)}` : null };
}

function copyEffects({ op, state }: RowInput): RowParts {
  const after = Array.isArray(op.effectPaths) ? state.translate("plan.row.effectCount", { count: op.effectPaths.length }) : state.translate("plan.row.allEffects");
  return { label: state.translate("plan.row.copyEffects"), after };
}

function withValue(label: PlainRowKey, field: string): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label), after: typeof op[field] === "string" ? String(op[field]) : null });
}

function valueRow(label: PlainRowKey, field: string): RowBuilder {
  return (input) => ({ label: input.state.translate(label), after: valueOf(input, input.op[field]) });
}

export const PROPERTY_ROWS: Readonly<Record<string, RowBuilder>> = {
  set_layer_property: setLayerProperty,
  animate_property: animateProperty,
  animate_control: animateControl,
  set_effect_control: setEffectControl,
  ensure_effect: ensureEffect,
  save_layer_preset: withValue("plan.row.saveEffectsPreset", "outputPath"),
  tracker_to_nulls: fixed("plan.row.nullsFromTracker"),
  resize_solid: resizeSolid,
  set_text_path: textOnPath,
  open_composition: fixed("plan.row.openComposition"),
  start_analysis: valueRow("plan.row.startAnalysis", "kind"),
  replace_layer_source: valueRow("plan.row.replaceLayerSource", "sourceItemId"),
  center_anchor: fixed("plan.row.centreAnchor"),
  copy_effects: copyEffects,
  set_puppet_pins: ({ op, state }) => ({ label: state.translate("plan.row.puppetPins"), after: state.translate("plan.row.pinCount", { count: Array.isArray(op.pins) ? op.pins.length : 0 }) }),
  remove_effect: ({ op, state }) => ({ label: state.translate("plan.row.removeEffect"), after: formatValue((stringAt(asObject(op.target), "effectPath") ?? "").replace("ADBE Effect Parade/", ""), false, state.translate) }),
  reorder_effect: ({ op, state }) => ({ label: state.translate("plan.row.reorderEffect"), after: state.translate("plan.row.place", { index: String(op.index) }) }),
  apply_preset: (input) => ({ label: input.state.translate("plan.row.applyPreset", { name: presetName(text(input.op.presetId) ?? text(input.op.presetFile), input) }) }),
  ensure_layer_style: (input) => ({ label: input.state.translate("plan.row.addLayerStyle", { style: humanizeName(text(input.op.style) ?? input.state.translate("plan.row.styleDefault")) }) }),
  set_expression: setExpression,
  set_loop: loopKeyframes,
  set_text_document: setText,
  ensure_text_animator: (input) => ({ label: input.state.translate("plan.row.textOpacity"), after: valueOf(input, input.op.value) }),
  add_text_animator: textAnimator("plan.row.addTextAnimator"),
  update_text_animator: textAnimator("plan.row.changeTextAnimator"),
};
