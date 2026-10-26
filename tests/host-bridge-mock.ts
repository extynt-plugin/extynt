/** Acknowledged host-bridge transport double used by tests; production has no missing-client bypass. */
export interface ReservationInput {
  readonly [field: string]: string | number | boolean | null;
}

export interface BridgeLease extends ReservationInput {
  readonly leaseId: string;
  readonly settlementToken: string;
  readonly epoch: string;
  readonly owner: string;
}

export interface BridgeAdmission {
  readonly status: 'admitted';
  readonly lease: BridgeLease;
}

export interface AcknowledgedBridge {
  readonly reserve: (input: ReservationInput, callback: (admission: BridgeAdmission) => void) => void;
  readonly settle: (lease: BridgeLease, outcome: string, callback: (settled: boolean) => void) => void;
}

/** Builds a bridge that admits every reservation and acknowledges every settlement. */
export function acknowledgedBridge(): AcknowledgedBridge {
  return {
    reserve(input, callback) {
      callback({ status: 'admitted', lease: { leaseId: 'mock-lease', settlementToken: 'mock-token', epoch: 'mock-epoch', owner: 'mock-panel', ...input } });
    },
    settle(_lease, _outcome, callback) {
      callback(true);
    },
  };
}
