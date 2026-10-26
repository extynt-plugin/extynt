// The shared dispatch lane's in-flight item: an outcome receipt is not proof that a timed-out native call has stopped, so a lane marked unresolved stays held until exact durable bridge callback proof releases it.
import type { InFlightItem } from "./server-types.js";

/** The item the host is working on, with the hold an unresolved native call puts on the lane. */
export class NativeFlight {
  private held: InFlightItem | undefined;

  public get current(): InFlightItem | undefined {
    return this.held;
  }

  public set current(value: InFlightItem | undefined) {
    if (this.held?.nativeSettlement === "unknown") return;
    this.held = value?.nativeSettlement === "unknown" ? Object.freeze({ ...value }) : value;
  }

  public release(id: string): void {
    if (this.held?.id === id && this.held.nativeSettlement === "unknown") this.held = undefined;
  }
}
