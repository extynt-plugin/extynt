# 0001: LLMs produce typed action plans

Status: accepted

## Decision

Language models produce structured, schema-validated action plans rather than directly executable After Effects scripts. A deterministic compiler and host adapter perform execution.

## Consequences

- Plans can be previewed, diffed, audited, tested, and migrated.
- Target resolution and safety policies do not depend on model behavior.
- Multiple model providers can share one execution contract.
- The supported operation vocabulary must be designed and expanded deliberately.
- Raw scripting remains possible only through a separately governed expert workflow.
