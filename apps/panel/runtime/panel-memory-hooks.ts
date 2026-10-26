/**
 * The moment the Memory section reloads on pairing with the sidecar. The startup code that knows that moment sits under
 * the transport, which the Memory view needs, so it announces here and the view listens; this module imports nothing.
 */
const pairedHooks: Array<() => void> = [];

/** Registers what to do once the panel has paired with the sidecar. */
export function onSidecarPaired(hook: () => void): void { pairedHooks.push(hook); }

/** Pairing finished and the startup services are being kicked off. */
export function sidecarPaired(): void { pairedHooks.forEach((hook) => { hook(); }); }
