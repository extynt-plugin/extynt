# Typed action plans

This package is the model-facing safety boundary for proposed After Effects
changes. It validates the typed v0.2 operation set:
each operation is allowlisted and checked against the snapshot.

Every target carries a composition ID, persistent layer ID, graph fingerprint,
selection fingerprint, and freshness revision. Plans require explicit
approval and are rejected when stale, expired, malformed, or outside the
allowlist. Approval is bound to a server-issued, one-time capability scoped to
the panel session and plan; callers cannot mint approval IDs. This package
performs no host calls and generates no JSX; it owns preview and approval
binding while the host adapter owns the narrow command compiler and execution
authority.
