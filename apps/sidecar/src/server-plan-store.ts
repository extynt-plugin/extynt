// Which project a stored plan belongs to, and whether two projects are the same.
import type { StoredPlan } from "@extynt/mcp-server";

/** Which project a plan belongs to: what After Effects reports for its name and file (null for a project never saved). */
export type ProjectIdentity = { name: string; filePath: string | null };

export function sameProject(left: ProjectIdentity | undefined, right: ProjectIdentity | undefined): boolean {
  return !!left && !!right && left.name === right.name && left.filePath === right.filePath;
}

/**
 * The sidecar's plan store. It is a plain Map to everything that reads or writes plans, with one addition: the first time a
 * plan is stored it is stamped with the project that was open (the plan's own snapshot is the latest one), and a plan that is
 * replaced keeps the stamp it had. That is how the history of changes can be scoped to one project; nothing else reads it.
 */
export class StampedPlanStore extends Map<string, StoredPlan> {
  constructor(private readonly openProject: () => ProjectIdentity | undefined) { super(); }

  override set(planId: string, record: StoredPlan): this {
    const project = record.project ?? this.get(planId)?.project ?? this.openProject();
    if (project && !record.project) record.project = { name: project.name, filePath: project.filePath };
    return super.set(planId, record);
  }
}
