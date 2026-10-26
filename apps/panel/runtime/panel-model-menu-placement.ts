/** Where the model popover goes: beside its button, inside the panel frame, on the side with more room. */

const MARGIN_PX = 12;
const GAP_PX = 8;
const MIN_ROOM_PX = 120;
const PREFERRED_WIDTH_PX = 300;
const FALLBACK_FRAME_WIDTH_PX = 900;
const FALLBACK_FRAME_HEIGHT_PX = 700;

interface FrameBox {
  readonly width: number;
  readonly height: number;
}

interface TriggerBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
}

interface Placement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface Vertical {
  readonly top: number;
  readonly height: number;
}

function verticalPlacement(trigger: TriggerBox, frame: FrameBox, desiredHeight: number): Vertical {
  const roomAbove = Math.max(0, trigger.top - GAP_PX - MARGIN_PX);
  const roomBelow = Math.max(0, frame.height - trigger.bottom - GAP_PX - MARGIN_PX);
  const below = roomBelow >= roomAbove;
  const room = below ? roomBelow : roomAbove;
  if (room < MIN_ROOM_PX) return { top: MARGIN_PX, height: Math.min(desiredHeight, Math.max(0, frame.height - MARGIN_PX * 2)) };
  const height = Math.max(0, Math.min(desiredHeight, room, frame.height - MARGIN_PX * 2));
  const top = below ? trigger.bottom + GAP_PX : trigger.top - GAP_PX - height;
  return { top: Math.max(MARGIN_PX, Math.min(top, frame.height - height - MARGIN_PX)), height };
}

/** The popover's box: as tall as its content within the room the frame leaves, below the button unless there is more room above. */
export function modelMenuPlacement(trigger: TriggerBox, frame: FrameBox, desiredHeight: number): Placement {
  const width = Math.max(0, Math.min(PREFERRED_WIDTH_PX, frame.width - MARGIN_PX * 2));
  const left = Math.max(MARGIN_PX, Math.min(trigger.left, frame.width - width - MARGIN_PX));
  return { left, width, ...verticalPlacement(trigger, frame, desiredHeight) };
}

/** The size of the panel frame, with a default for a page that reports none. */
export function frameBox(): FrameBox {
  return { width: window.innerWidth || FALLBACK_FRAME_WIDTH_PX, height: window.innerHeight || FALLBACK_FRAME_HEIGHT_PX };
}

/** Where the button sits on screen. */
export function triggerBox(trigger: HTMLElement): TriggerBox {
  const rect = trigger.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left };
}
