/**
 * The two moments the prompt suggestions react to: the panel's focus naming a selection, and a turn starting or ending. The
 * modules that know them sit under the suggestion view, which needs them, so they announce here and the view listens; this
 * module imports nothing.
 */
type SelectionHook = (fingerprint: string, selected: number) => void;
type TurnHook = (running: boolean) => void;

const selectionHooks: SelectionHook[] = [];
const turnHooks: TurnHook[] = [];

/** Registers a listener for the selection the sidecar fingerprinted. */
export function onSelectionRead(hook: SelectionHook): void {
  selectionHooks.push(hook);
}

/** Registers a listener for a turn starting or ending. */
export function onTurnRunning(hook: TurnHook): void {
  turnHooks.push(hook);
}

/** The focus names the open composition's selection by `fingerprint`, with `selected` layers in it. */
export function announceSelection(fingerprint: string, selected: number): void {
  selectionHooks.forEach((hook) => hook(fingerprint, selected));
}

/** A turn started (`true`) or ended (`false`). */
export function turnRunning(running: boolean): void {
  turnHooks.forEach((hook) => hook(running));
}
