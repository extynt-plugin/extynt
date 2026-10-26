/**
 * Shared inline SVG icon renderer. The geometry is the typed table in icons.ts, bundled with the panel. Live model
 * reasoning is drawn by panel-chat's expandable #chat-live row; this module holds no transcript or reasoning state.
 */
import { ICONS } from "./icons.js";
import type { IconCircle, IconName, IconPath, IconSpec } from "./icons.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_NAMES: ReadonlySet<string> = new Set(Object.keys(ICONS));

function isIconName(name: string): name is IconName {
  return ICON_NAMES.has(name);
}

function shapeAttributes(shape: IconPath | IconCircle): ReadonlyArray<readonly [string, string | undefined]> {
  if (shape.tag === "circle") return [["cx", shape.cx], ["cy", shape.cy], ["r", shape.r]];
  return [["d", shape.d], ["fill-rule", shape.fillRule], ["clip-rule", shape.clipRule], ["transform", shape.transform]];
}

function appendShape(svg: SVGElement, shape: IconPath | IconCircle): void {
  const node = document.createElementNS(SVG_NS, shape.tag);
  for (const [name, value] of shapeAttributes(shape)) {
    if (value !== undefined) node.setAttribute(name, value);
  }
  node.setAttribute("fill", "currentColor");
  svg.appendChild(node);
}

/** The icon with this name drawn at `size` (its own size by default), or nothing when the table has no such icon. */
export function iconElement(name: string, size?: number): SVGElement | null {
  if (!isIconName(name)) return null;
  const spec: IconSpec = ICONS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  const drawn = String(size || spec.size);
  svg.setAttribute("class", "icon icon-" + name);
  svg.setAttribute("viewBox", "0 0 " + spec.size + " " + spec.size);
  svg.setAttribute("width", drawn);
  svg.setAttribute("height", drawn);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  spec.shapes.forEach((shape) => appendShape(svg, shape));
  return svg;
}
