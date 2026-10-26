/** Reads the sidecar's plan store back through its own tools: which plans a turn left, and the operations they hold. */
import { decode } from "@extynt/decode";
import { planListEnvelope, recallEnvelope } from "./envelopes.js";
import type { PlanStoreRow } from "./run-types.js";
import type { SidecarHandle } from "./sidecar-client.js";

type PlanTools = Pick<SidecarHandle, "callTool">;

const MAX_RECALL_PAGES = 32;

async function recalledPage(sidecar: PlanTools, planId: string, cursor: number): Promise<{ text?: string; next?: number }> {
  const recalled = decode(recallEnvelope, await sidecar.callTool("ae_recall_plan", { planId, cursor }).catch(() => ({})));
  if (!recalled.ok) return {};
  const { operations, nextCursor } = recalled.value.data;
  return { ...(operations ? { text: JSON.stringify(operations) } : {}), ...(nextCursor !== undefined ? { next: nextCursor } : {}) };
}

/** Every page of every plan's operations, as the JSON text the store returned. */
export async function recalledOperations(sidecar: PlanTools, planIds: readonly string[]): Promise<string[]> {
  const pages: string[] = [];
  for (const planId of planIds) {
    let cursor: number | undefined = 0;
    for (let page = 0; page < MAX_RECALL_PAGES && cursor !== undefined; page += 1) {
      const recalled = await recalledPage(sidecar, planId, cursor);
      if (recalled.text) pages.push(recalled.text);
      cursor = recalled.next;
    }
  }
  return pages;
}

/** Every plan the store lists, with its status. */
export async function planStoreRows(sidecar: PlanTools): Promise<PlanStoreRow[]> {
  const listed = decode(planListEnvelope, await sidecar.callTool("ae_list_plans", { limit: 200 }).catch(() => ({})));
  if (!listed.ok) return [];
  return listed.value.data.flatMap((row) => (row.planId === undefined ? [] : [{ planId: row.planId, status: row.status ?? "" }]));
}
