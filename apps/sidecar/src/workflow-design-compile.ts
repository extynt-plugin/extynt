// Compiles the visual-scene designer's SVG drawing against the open composition and keeps the result for the build.

import { compileSvgScene, sceneManifest, type CompiledScene } from "@extynt/mcp-server";
import { getActiveComposition, type ProjectSnapshot } from "@extynt/project-graph";

/** A compiled drawing, kept for the build and for ae_queue_design when the designer could not build it. */
export interface SceneDesign {
  readonly svg: string;
  readonly scene: CompiledScene;
  readonly compositionId: string | null;
  readonly targetCompositionPlaceholder?: string;
  readonly compiledAt: string;
}

/** The layers a compiled drawing builds, with their positions, bounds and palette. */
export type SceneManifest = ReturnType<typeof sceneManifest>;

type DesignCompilation = { readonly ok: true; readonly design: SceneDesign; readonly manifest: SceneManifest } | { readonly ok: false; readonly message: string };
type DesignComposition = ProjectSnapshot["compositions"][number];

const SCATTER_LAYER = /star|dot|particle|sparkle/iu;
const SCATTER_VERTICES = 6;
const EMPTY_DRAWING = "svg must be the whole scene as one <svg viewBox=\"0 0 W H\">…</svg>, where W×H is the composition's size.";

function scatterComplaint(scene: CompiledScene): string | undefined {
  for (const layer of scene.layers) {
    if (!SCATTER_LAYER.test(layer.name)) continue;
    const web = layer.shapes.find((shape) => !shape.fill && !!shape.stroke && shape.paths.some((path) => !path.closed && path.vertices.length > SCATTER_VERTICES));
    if (web) return `Layer "${layer.name}" draws its marks as one open stroke-only path with ${Math.max(...web.paths.map((path) => path.vertices.length))} vertices, which renders as a web of lines, not as points. Draw each star as a <circle> (use data-scatter when there are many).`;
  }
  return undefined;
}

function designCompositionId(composition: DesignComposition | undefined, scene: CompiledScene, target: string | undefined): string | null {
  if (target) return composition?.id ?? null;
  return composition && composition.width === scene.width && composition.height === scene.height ? composition.id : null;
}

/**
 * Compiles the drawing into a design plus its manifest, or says why it cannot be used. The drawing's canvas is the designer's intended composition: it is never
 * scaled to the open one, which would silently place a newly requested scene in a composition that is not open yet. A scatter layer (stars, dots, particles)
 * drawn as one long open stroke renders as a web of lines, so that drawing is refused and the designer is told to draw circles.
 */
export function compileDesign(svg: string | undefined, snapshot: ProjectSnapshot, now: () => Date, target?: string): DesignCompilation {
  if (!svg?.trim()) return { ok: false, message: EMPTY_DRAWING };
  const composition = target ? snapshot.compositions.find((item) => item.id === target) : getActiveComposition(snapshot);
  const compiled = compileSvgScene(svg);
  if (!compiled.ok) return { ok: false, message: `The scene drawing did not compile (${compiled.code}): ${compiled.message}` };
  const web = scatterComplaint(compiled.scene);
  if (web) return { ok: false, message: web };
  return { ok: true, design: { svg, scene: compiled.scene, compositionId: designCompositionId(composition, compiled.scene, target), compiledAt: now().toISOString() }, manifest: sceneManifest(compiled.scene) };
}
