// The few controls of the effects a request most often names, for the briefing's resolved-recipe block.
import { BASE_CATALOGUE } from "./curated-catalogue.js";

/** One control as a model needs it to write set_effect_control: the matchName, the label After Effects shows, and the value rule the host reports. */
export interface RecipeControl {
  readonly matchName: string;
  readonly name: string;
  readonly rule: string;
}

/** A curated effect with the controls a build usually sets. */
export interface RecipeEffect {
  readonly matchName: string;
  readonly capabilityId: string;
  readonly displayName: string;
  readonly controls: readonly RecipeControl[];
}

const RECIPE_CONTROLS: Readonly<Record<string, readonly RecipeControl[]>> = {
  "ADBE Glo2": [
    { matchName: "ADBE Glo2-0002", name: "Glow Threshold", rule: "0-255" }, { matchName: "ADBE Glo2-0003", name: "Glow Radius", rule: "0-1000 px" },
    { matchName: "ADBE Glo2-0004", name: "Glow Intensity", rule: "0-255, 1 = default" }, { matchName: "ADBE Glo2-0012", name: "Color A", rule: "[r,g,b] 0-1" }, { matchName: "ADBE Glo2-0013", name: "Color B", rule: "[r,g,b] 0-1" },
  ],
  "ADBE Drop Shadow": [
    { matchName: "ADBE Drop Shadow-0001", name: "Shadow Color", rule: "[r,g,b] 0-1" }, { matchName: "ADBE Drop Shadow-0002", name: "Opacity", rule: "0-255, not percent" }, { matchName: "ADBE Drop Shadow-0003", name: "Direction", rule: "degrees" },
    { matchName: "ADBE Drop Shadow-0004", name: "Distance", rule: "px" }, { matchName: "ADBE Drop Shadow-0005", name: "Softness", rule: "px" },
  ],
  "ADBE Gaussian Blur 2": [
    { matchName: "ADBE Gaussian Blur 2-0001", name: "Blurriness", rule: "0-30000" }, { matchName: "ADBE Gaussian Blur 2-0002", name: "Blur Dimensions", rule: "1 both, 2 horizontal, 3 vertical" }, { matchName: "ADBE Gaussian Blur 2-0003", name: "Repeat Edge Pixels", rule: "0 or 1" },
  ],
  "ADBE Ramp": [
    { matchName: "ADBE Ramp-0001", name: "Start of Ramp", rule: "[x,y] layer px" }, { matchName: "ADBE Ramp-0002", name: "Start Color", rule: "[r,g,b] 0-1" }, { matchName: "ADBE Ramp-0003", name: "End of Ramp", rule: "[x,y] layer px" },
    { matchName: "ADBE Ramp-0004", name: "End Color", rule: "[r,g,b] 0-1" }, { matchName: "ADBE Ramp-0005", name: "Ramp Shape", rule: "1 linear, 2 radial" },
  ],
};

/** The resolved capability for an effect matchName: its catalogue id and the controls a build usually sets, from the After Effects 26.2.1 control census (a test pins every row to it); undefined when the catalogue has no curated entry for it. */
export function recipeEffect(matchName: string): RecipeEffect | undefined {
  const capability = BASE_CATALOGUE.capabilities.find((candidate) => candidate.kind === "effect" && candidate.matchName === matchName);
  const controls = RECIPE_CONTROLS[matchName];
  return capability && controls ? { matchName, capabilityId: capability.id, displayName: capability.displayName, controls } : undefined;
}

/** The match names of the effects that have a recipe. */
export const RECIPE_EFFECT_MATCH_NAMES: readonly string[] = Object.keys(RECIPE_CONTROLS);
