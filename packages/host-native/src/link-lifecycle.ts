// Closes the whole plugin link exactly once: the first of host-closing, a reset or a client close wins and the rest are ignored.
import type { ConnectOptions } from "./client-types.js";

export type LostReason = "timeout" | "closed" | "protocol" | "shutting-down";
type CloseReason = Parameters<ConnectOptions["onClose"]>[0];

const HOST_CLOSING_GRACE_MS = 100;

export class Lifecycle {
  private finished = false;
  private resetTimer: NodeJS.Timeout | null = null;
  private readonly closers: Array<(reason: LostReason) => void> = [];
  private readonly onClose: ConnectOptions["onClose"];

  constructor(onClose: ConnectOptions["onClose"]) { this.onClose = onClose; }

  register(closer: (reason: LostReason) => void): void {
    if (this.finished) closer("closed");
    else this.closers.push(closer);
  }

  closeWithoutReport(): void {
    this.finished = true;
    this.closeAll("closed");
  }

  finish(reason: CloseReason): void {
    if (this.finished) return;
    this.closeWithoutReport();
    this.onClose(reason);
  }

  resetUnlessHostClosing(): void {
    if (this.finished || this.resetTimer) return;
    this.resetTimer = setTimeout(() => this.finish("reset"), HOST_CLOSING_GRACE_MS);
  }

  hostClosing(): void {
    if (this.finished) return;
    this.finished = true;
    this.closeAll("shutting-down");
    this.onClose("host-closing");
  }

  private closeAll(reason: LostReason): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    for (const closer of this.closers) closer(reason);
  }
}
