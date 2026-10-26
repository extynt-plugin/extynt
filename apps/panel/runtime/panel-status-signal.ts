/**
 * "Something the status bar or the sheet shows changed." The modules that know (the chat, the plans, the variants, the
 * progress poll) announce here and the two views listen; this module imports nothing, so no cycle can form through it.
 */
const listeners: Array<() => void> = [];

export function onStatusTouched(listener: () => void): void { listeners.push(listener); }
export function touchStatus(): void { for (const listener of listeners.slice()) listener(); }
