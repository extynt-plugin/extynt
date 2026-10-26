// set_puppet_pins: places Puppet pins at exact positions on a layer and moves or keys them, with no user pin placement and no mouse.
// The operation types, the pin shapes and the pin limit are the public contract; the rule below validates one operation against them.
import { isJsonArray } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { layerTarget, type OperationContext } from "./layer-targets.js";
import { invalid, isFiniteInRange, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";
import type { JsonValue } from "@extynt/decode";

const MAX_PUPPET_PINS = 64;
const MAX_PIN_KEYS = 256, MAX_COORDINATE = 1_000_000, MAX_TIME_SECONDS = 86_400;

function isCoordinate(value: JsonValue | undefined): boolean { return isFiniteInRange(value, -MAX_COORDINATE, MAX_COORDINATE); }

function keyTime(key: JsonValue, where: string, previous: number): Refusal | number {
  const shape = isJsonObject(key) && !rejectUnknown(key, ["time", "x", "y"]) && isFiniteInRange(key.time, 0, MAX_TIME_SECONDS) && isCoordinate(key.x) && isCoordinate(key.y);
  if (!shape) return invalid("INVALID_VALUE", `${where} must be { time, x, y } in layer pixels and composition seconds.`);
  const time = key.time;
  return typeof time === "number" && time > previous ? time : invalid("INVALID_VALUE", `${where}.time must be strictly increasing.`);
}

function keysCount(keyframes: JsonValue, where: string): Refusal | number {
  if (!isJsonArray(keyframes) || keyframes.length < 1 || keyframes.length > MAX_PIN_KEYS) return invalid("INVALID_VALUE", `${where}.keyframes must hold 1-${MAX_PIN_KEYS} keys.`);
  let previous = -1;
  for (const [k, key] of keyframes.entries()) {
    const time = keyTime(key, `${where}.keyframes[${k}]`, previous);
    if (isRefusal(time)) return time;
    previous = time;
  }
  return keyframes.length;
}

function pinKeys(pin: JsonValue, index: number): Refusal | number {
  const where = `set_puppet_pins pins[${index}]`;
  if (!isJsonObject(pin) || rejectUnknown(pin, ["x", "y", "keyframes"]) || !isCoordinate(pin.x) || !isCoordinate(pin.y)) return invalid("INVALID_VALUE", `${where} must be { x, y, keyframes? } in layer pixels.`);
  const keyframes = pin.keyframes;
  return keyframes === undefined ? 0 : keysCount(keyframes, where);
}

function pinsResult(pins: JsonValue | undefined): OperationResult {
  if (!isJsonArray(pins) || pins.length < 1 || pins.length > MAX_PUPPET_PINS) return invalid("INVALID_VALUE", `set_puppet_pins needs 1-${MAX_PUPPET_PINS} pins.`);
  let keys = 0;
  for (const [index, pin] of pins.entries()) {
    const count = pinKeys(pin, index);
    if (isRefusal(count)) return count;
    keys += count;
  }
  return { ok: true, keyframes: keys };
}

/**
 * Validates set_puppet_pins. The first call wraps the layer in a square 1080 x 1080 carrier composition so a fixed mesh preset fits any
 * asset or composition size, and replaces the layer with the carrier layer (the receipt returns carrierLayerId; address that layer from
 * then on); a call on a carrier layer re-pins it. Each pin sits exactly at x, y (composition pixels, any point) at time 0 with the layer
 * undeformed at rest, and keyframes travel it from there; relative:true makes every key an offset from x, y. Up to 16 pins use a 4x4
 * mesh, more use a 12x12 mesh. Layers that cannot be wrapped (3D, parented or with children parented to them, track mattes, adjustment,
 * animated opacity) are refused by the host with PUPPET_LAYER_UNSUPPORTED.
 */
export function validateSetPuppetPins(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "pins", "relative"]);
  if (unknown) return unknown;
  if (operation.relative !== undefined && typeof operation.relative !== "boolean") return invalid("INVALID_VALUE", "relative must be boolean.");
  const target = layerTarget(context, false);
  return isRefusal(target) ? target : pinsResult(operation.pins);
}
