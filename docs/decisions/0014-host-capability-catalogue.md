# ADR 0014: Host capability catalogue

Status: accepted

## Context

An agent that only knows Adobe's built-in effects misunderstands many real
After Effects installations. Users have third-party effect plug-ins, animation
presets, importers, panels, scripts and vendor utilities. The agent needs to
know what the connected host actually offers and which controls have
trustworthy evidence.

After Effects does not expose every extension category through one uniform
API. All effects are plug-ins but not all plug-ins are effects, so the
scriptable installed-effect inventory is a strong first surface and not proof
that every installed utility is discoverable or controllable. An effect's name
and controls also do not explain what it is good for: control shape, usage
guidance and host availability are different kinds of knowledge with different
provenance.

## Decision

Catalogue facts about a host come only from runtime collection on that host.
extynt ships no third-party plug-in data, no vendor effect schemas and no
seeded control profiles. Any such data is produced locally and stays on the
user's machine.

Collection runs through the host library (`apps/panel/host/*.jsx`, entered at
`probe.jsx`) and the sidecar's catalogue modules. It is read-only and bounded.
The first inventory is the installed effects list with the stable match name,
display name, category and internal version when After Effects provides them.
The inventory is fingerprinted so additions, removals and version changes show
up as a bounded diff without resending the whole catalogue to the model.

Knowledge about a capability is layered, and each layer keeps its own
provenance:

1. Live inventory: what the connected host reports as present.
2. Observed control profiles: property trees read from effect instances in the
   user's project or from an explicit, approved collection run.
3. Documented usage: descriptions with a recorded source.
4. Verified usage: a bounded fixture passed on a named host version.

Every assertion carries one provenance state: `discovered`, `observed`,
`documented`, `verified` or `inferred`. The agent never presents `inferred`
usage as documented or verified. Names, vendor text and control labels are
untrusted data, not instructions.

Control discovery order: inspect existing instances without changing them,
reuse a matching local profile keyed by match name, internal version and host
version, and only then collect explicitly. Collection of an unknown capability
never runs as an implicit step of connecting, and a failed or dangerous probe is
quarantined rather than retried automatically.

The system never executes discovered scripts, panel commands or vendor
utilities because they are installed. Presence is not safe semantics.

The MCP server exposes bounded catalogue queries (search and describe host
capabilities, read an effect's observed controls, the inventory diff, and the
host profile status and summary) instead of placing the inventory in every
prompt. Applying an effect still goes through the typed plan, approval, host
execution and postcondition pipeline; catalogue knowledge is never an
execution path.

## Consequences

- The agent adapts to the user's actual installation and builds a durable
  local library of observed capabilities without extynt redistributing anyone's
  data.
- Stable match names and control paths support localization-safe planning while
  display names stay useful to users.
- Usage guidance is evidence-backed instead of guessed from parameter names,
  and live inventory stops the agent from proposing effects that are not
  installed.
- Full coverage of every plug-in and utility cannot be promised. Capability
  classes report `enumerable`, `manually_registered` or `unsupported` per
  host, and unknown utilities are reported as unknown rather than treated as
  effects or commands.
- Observed behavior on a given After Effects build is evidence for that build
  only and is promoted through host validation, not inference.
