/** A real sidecar (spawned, mock provider) talking to the fixture project through the fake plugin, as the chat-test harness does. */
import { compositionAsset, freshProbe } from "../src/assets.js";
import { fixtureSnapshotFromProbe } from "../src/fake-host-probe.js";
import { isolatedProfileDirectory } from "../src/host-profile.js";
import { untilRead, untilSettled, workflowOf } from "../src/fake-plugin-wait.js";
import { startFakePluginHost, type FakePluginHost, type FakePluginHostOptions } from "../src/fake-plugin-host.js";
import type { SidecarHandle } from "../src/sidecar-client.js";
import { startSidecar, type SidecarStartOptions } from "../src/sidecar.js";
import type { WorkflowProjection } from "../src/workflow-projection.js";
import type { WireObject } from "../src/wire-types.js";

export interface PluginRig {
  sidecar: SidecarHandle;
  host: FakePluginHost;
  probe: WireObject;
  workflow(): Promise<WorkflowProjection>;
  read(): Promise<void>;
  settle(): Promise<void>;
  stop(): Promise<void>;
}

export interface RigOptions {
  sidecar?: SidecarStartOptions;
  host?: Pick<FakePluginHostOptions, "receiptMode" | "beforeMutation" | "afterMutation" | "beforeRead" | "censusDelayMs">;
}

/**
 * A sidecar and a fake plugin joined and ready. Anything started before a step fails is stopped again: the caller registers its cleanup only
 * once this returns, so a throw here would otherwise leave the sidecar process (and its pipes) holding the test file open.
 */
export async function startRig(tag: string, options: RigOptions = {}): Promise<PluginRig> {
  const sidecar = await startSidecar({ kind: "mock" }, options.sidecar);
  let host: FakePluginHost | undefined;
  try {
    await sidecar.patchPrefs({ askBeforeApplying: "never" });
    const probe = freshProbe(compositionAsset("summer-launch"), `probe-${tag}`);
    host = await startFakePluginHost({
      stateDirectory: isolatedProfileDirectory(sidecar.isolatedHome),
      censusDirectory: sidecar.profileSource,
      snapshot: fixtureSnapshotFromProbe(probe),
      ...options.host,
    });
    const rig = rigOver({ sidecar, host, probe });
    await rig.read();
    return rig;
  } catch (error) {
    await host?.stop();
    await sidecar.stop();
    throw error;
  }
}

function rigOver({ sidecar, host, probe }: Pick<PluginRig, "sidecar" | "host" | "probe">): PluginRig {
  return {
    sidecar, host, probe,
    workflow: () => workflowOf(sidecar),
    async read() {
      const unread = await untilRead(sidecar, host);
      if (unread) throw new Error(unread);
    },
    settle: () => untilSettled(sidecar, host),
    async stop() { await host.stop(); await sidecar.stop(); },
  };
}
