// Everyday ways to ask for a camera, light or path property without naming it: drawing a line on, a camera that looks at something, a softer beam edge.
import type { ConceptRow } from "./resolution-concepts.js";

/** Rows that point a plain-language request at the trim end, the camera zoom and point of interest, and the cone feather and angle of a light. */
export const EVERYDAY_PROPERTY_WORDS: ReadonlyArray<ConceptRow> = [
  ["draw it on, draws on, drawn on, draw it in, draw itself, write it on, que se dibuje, se vaya dibujando, dibujar poco a poco, aufzeichnen, nach und nach zeichnen, wird gezeichnet, dessine le trait, se dessine, tracer progressivement, 描くように, 描かれていく, 描いていく, 画出来, 一点点画, 逐渐画出", "end", 4],
  ["zoom con la camara, haz zoom con la camara, hacer zoom con la camara, zoom de la camara, zoom a la camara", "zoom", 5],
  ["camera look at, camera looks at, make the camera look, que la camara mire, la camara mire, camara regarde, la camera regarde, kamera schauen, kamera blicken, 看向, カメラが見る, カメラを向けて", "=point_of_interest", 7],
  ["soften the beam, soften the beam edges, softer beam edges, soften the spotlight edge, bordes del haz, suaviza los bordes del haz, bords du faisceau, bord du faisceau plus doux, bords du faisceau plus doux, kanten des lichtkegels, die kanten des lichtkegels weicher, lichtkegel weicher, 光の縁をぼかして, 光束边缘, 光束的边缘", "=cone_feather feather", 9],
  ["spotlight narrower, make the spotlight narrower, make the beam narrower, make the beam wider, beam wider, beam narrower, haz mas estrecho, den lichtkegel schmaler, den lichtkegel breiter, rends le faisceau plus etroit, 光束更窄, 光束更宽, 光の幅", "=cone_angle angle", 8],
];
