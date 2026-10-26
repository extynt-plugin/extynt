/**
 * Late-bound calls between panel modules that would otherwise import each other. The composition root assigns the real
 * functions once everything is loaded; until then each hook does nothing.
 */
import type { NewRow, NoticeAction } from "./transcript.js";

interface PanelHooks {
  notice(text: string, tone?: string, action?: NoticeAction, transient?: boolean): HTMLElement | null;
  addRow(row: NewRow): HTMLElement | null;
  renderTranscript(): void;
  fillComposer(text: string): void;
  sendChat(): void;
  sendLongPrompt(text: string): void;
  openPage(view: string): void;
  openSheet(planId?: string): void;
  openModelSettings(): void;
  refreshPlans(): void;
  refreshChanges(): void;
  refreshVariants(): void;
  isChatInFlight(): boolean;
  setComposerBusy(busy: boolean): void;
}

const none = (): null => null;

export const hooks: PanelHooks = {
  notice: none,
  addRow: none,
  renderTranscript: () => undefined,
  fillComposer: () => undefined,
  sendChat: () => undefined,
  sendLongPrompt: () => undefined,
  openPage: () => undefined,
  openSheet: () => undefined,
  openModelSettings: () => undefined,
  refreshPlans: () => undefined,
  refreshChanges: () => undefined,
  refreshVariants: () => undefined,
  isChatInFlight: () => false,
  setComposerBusy: () => undefined,
};
