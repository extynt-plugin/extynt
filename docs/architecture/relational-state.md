# Typed relational state in `.extynt`

`.extynt` is a SQLite database owned by the local sidecar. It retains typed,
bounded project observations, effect and parameter definitions, provenance,
coverage, and requested parameter changes. After Effects remains the authority
for the current project. A database row, filename, recent timestamp, definition,
approval, or settled bridge callback alone cannot establish that an edit is safe
or that its desired value is present in AE.

This document describes the implemented source boundaries. It supplements
[the architecture overview](README.md) and
[the coding rules](../coding-rules.md). Linux integration tests execute the
real sidecar, HTTP routes, SQLite, panel scheduler and native lease client, and
shipped ExtendScript against simulated native getters/setters. They are evidence
about these contracts; they do not establish real AE behavior, performance, or
plugin compatibility.

## Ownership and files

`SidecarState` creates `CollectionService`, `ProjectGraphStore`, and the durable
`NativeBridgeLease`. `ProjectGraphStore` selects one project file only after an
accepted native observation. Saved-project identity uses the native file path
and platform; unsaved identity includes the sidecar session, paired panel, and
native project epoch. The safe hashed filenames live under the sidecar's
`graphs/` directory. `host-catalogue.extynt` holds host installation observations
separately. Files and provenance do not imply globally stable AE identities.

`GraphStore` owns the SQLite connection and transactions. The panel neither
opens the database nor exposes SQL. Agents cannot select a database path or send
SQL. `graph-sql.ts` prepares infrastructure-owned statements; domain helpers
validate typed arguments and bind values. Property addresses use native
matchNames, effect ordinals, relative matchName paths and native index paths.
Display names remain descriptive; duplicated effects and reordered properties
require current native evidence.
Repeated native matchNames keep distinct instance ordinals. Demand-only value
enrichment reuses a descriptor identity only when the full observed native
index path and matchNames agree; a display path alone cannot choose a sibling.

## JSON boundaries and relational data

JSON remains the transport format for provider tool calls, authenticated HTTP,
native lane host calls, typed action plans, receipts, and diagnostic or
workflow journals. These wire envelopes are validated before they affect state.
They are not serialized graph blobs in SQLite. SQLite stores typed columns,
foreign keys, constrained state vocabularies, numeric component rows and
explicit nullable facts. Native expression source is not a relational control
value; descriptor and value discovery report expression presence instead.

Schema version 3 retains the original project, scope, node, item, layer,
property, native index, numeric value, installed-effect and preset relations.
It adds these distinct domains:

| Domain | Relations | Meaning |
| --- | --- | --- |
| Definition evidence | `definition_sources`, `plugin_definitions`, `effect_definitions`, `parameter_definitions`, `parameter_definition_facts`, `parameter_default_components` | Host/version-specific definitions and independently sourced facts |
| Observational links | `effect_definition_links`, `parameter_definition_links`, `value_definition_links` | Relationships from discovered native nodes to definitions and property value observations |
| Current instances | `effect_instances`, `control_instances`, `control_observations`, `control_observation_components` | Native address and most recently accepted bounded control evidence |
| Scope evidence | `scope_coverage` | Exactly what a demand observed, with owner/session/stamp and unknown outside-scope fields |
| Desired edits | `desired_control_requests`, `desired_control_components` | A requested value, its source observation and plan/read-set binding; separate from observed AE values |

The tables are `STRICT`; foreign keys and constrained state columns prevent
incompatible representations. A control's numeric vector components have an
explicit order and a maximum of 16. Legacy key-value observations retain their
key index and time. A control instance's current scalar value does not silently
become a collection of evaluated samples or a definition default.

## Definitions, discovery and unknown facts

`packages/project-graph/src/effect-definitions.ts` defines the portable domain
types. Definition storage is implemented by the sidecar's
`effect-definition-*.ts` modules. A fact has a provenance identity. Documented
facts require a source URL and identify official or authored documentation.
Native facts identify the host, observation time and observation context; facts
about a property or factory default also bind the native instance. Separate
source rows prevent an authored description from masquerading as an AE getter.

An installed effect census establishes installation evidence and names. A
bounded property descriptor establishes only the fields it actually read, such
as native value type, bounds, capability flags and native units text when
available. It does not establish a plugin vendor, human meaning, factory
default, expression dependency closure, or complete parameter universe.
Native description and meaning stay null. A current value is never promoted
to a default. Factory-default evidence requires its own context and provenance.
No universal units or range-to-meaning mapping is inferred.
An observed empty native units label (`""`) remains distinct from unavailable
units (`null`); neither supplies a human unit meaning or conversion rule.

`canVaryOverTime` and `canSetExpression` are definition/capability facts.
`keyframeCount`, `isTimeVarying`, `expressionEnabled` and expression presence are
current instance evidence. An enabled expression cannot be reported as an
observed static value. Underlying key values can be demanded separately from
expression evaluation; their interpolation, easing and downstream dependencies
remain unknown unless a distinct collector establishes those facts. Unsupported
custom, text, shape or unavailable native values remain unknown.

## Bounded collection and queries

`CollectionService` validates one target and owns generation, cursor/session
continuations and exact dispatch tickets. `collection.jsx` performs bounded
index, layer, descriptor, value, and demonstrated local effect reads. The agent
receives pages through `ae_read_graph_page` and waits on the existing demand
through `ae_get_graph_page`. It receives data and continuation identities, never
host source. The sidecar queues the dispatch for the paired panel; the panel
admits it and invokes the infrastructure-selected native function.

Descriptor traversal is paged and retains the effect ancestry already visited.
It does not rescan every effect for each control. Value getters run only for
explicit demanded value or demonstrated local-operation evidence. A terminal
cursor means this traversal reached its end; it does not prove unknown fields,
other compositions, deleted rows or expression dependencies are absent.

`ae_query_graph_cache` keeps the original bounded observational interface.
`ae_query_relational_graph` uses a typed query discriminator for effect
definitions, parameter definitions/facts, controls, coverage or desired
requests. `ae_describe_control` pages evidence for an exact parameter definition.
Exact scope keys and keyset cursors bound queries to at most 25 rows; definition
fact pages are capped at 8 and retain their own cursor. Arbitrary joins, SQL,
executable code and caller-selected column lists are unavailable.
The coverage query has a fixed 25-scope cap and reports truncation explicitly;
it does not claim that a truncated response covers every retained scope.

All descriptive responses carry `writeAuthorizing: false`. A control query
returns its instance and definition identities, native address, source
observation identity, collection/panel session, stamp, observation time and
current field evidence. Definitions are reusable knowledge. Current state still
depends on the accepted native scope and ownership.

## Effect value notes

`ae_read_effect_notes` and `ae_write_effect_note` sit beside the relational
tools and are dispatched by the sidecar for both external MCP clients and the
in-panel agent. They are not project writes: no plan, approval or After Effects
call is involved, every response carries `writeAuthorizing: false`, and nothing
in the plan, apply or verification path reads a note. A read returns observed
facts first and separately (projected from the newest catalogue probe of the
current host), then labelled notes (`measured` evidence, `agent-inferred`
guesses), then usage statistics computed from the bounded `effect_value_usage`
rows. Notes, usage rows, per-plan contributions, usage events (which effects,
fonts and presets the user reaches for, ranked on read), animation habit samples
(keyframe span, count and easing of kept animations) and the per-plugin opt-in
live in six additive STRICT tables of the host catalogue file
(`effect_value_notes`, `effect_value_usage`, `effect_value_usage_plans`,
`effect_usage_events`, `animation_habit_samples`, `effect_note_plugin_optin`), created idempotently like the
other catalogue tables. Nothing is seeded. Usage is learned from three hooks that
only add calls: a verified apply receipt (`server-receipts.ts`), a whole-plan undo
receipt that removes it again, and an accepted project snapshot
(`server-http-routes.ts`); see `effect-notes-learn*.ts`.
The full rules (caps, read-before-write, replace-with-reason, history, plugin
opt-in, "Learn from my work") are in [the effect notes document](effect-notes.md).

## Freshness, invalidation and native authority

Fresh retained observations must match the active store owner, project epoch
and non-null native revision, and have a nonnegative age below 15 seconds.
Unknown revision is unknown evidence. A fresh row is an observation, not proof
that no manual edit occurred after the getter. Observed native revision changes,
incompatible accepted snapshots, panel replacement, logical invalidation,
failed page validation and admitted mutation retire current authority.
Reopening a file preserves history and definitions without restoring current
ownership or coverage.

Every page is validated before rows are published. Native IDs, ordinals,
descriptor paths, value shapes, component bounds, page/session/request
identities and increasing cursors are checked. Metadata layer inventories are
published only after a contiguous, unique, bounded inventory completes.
SQL page writes run in one transaction. A malformed later row cannot leave a
successful prefix from that page. Previously retained rows may survive on disk
as history while current queries become unknown or stale.

Freshness is checked again at request preparation, approval, claim/apply
admission and inside the same native apply call. Metadata/local-operation read
sets bind the approved plan digest, exact native stamp, address and required
local facts. The native guard checks that binding before setters run, and a
readback validates the resulting state. This closes the query-to-apply race for
the demonstrated local adapter; it does not establish a perfect project mirror
or expression dependency closure.

## Typed parameter requests and confirmation

`ae_prepare_parameter_change` accepts an exact control instance and source
observation plus a typed native numeric value. An optional unit must exactly
match observed native spelling; semantic conversions are unavailable. The
adapter checks ownership, age, stamp, exact target, scalar type, current native
range, settable status and explicit expression/animation state before producing
an existing typed action-plan operation. It enters the same plan, preview,
approval, compilation and panel delivery pipeline as other work.

The demonstrated writable adapter is currently Gaussian Blur Blurriness:
`ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001`, under its complete local
static literal-assignment read set. Other controls and plugin parameters can
have relational definitions and observations while a write returns
`PARAMETER_WRITE_UNSUPPORTED`. Animated or expression-bearing state needs its
own demonstrated policy; a static request does not silently overwrite it.

Requested numeric components belong to `desired_control_requests`, which moves
through prepared, bound, verified or invalidated states. Preparing a request,
approving it, reserving the bridge or receiving a setter callback cannot copy
desired components into `control_observations`. Confirmation requires the
exact plan/ticket/read-set/panel/source-observation binding and a complete
validated host readback. The readback must match the requested native value and
address and carry a consistent post-apply stamp. The original approval,
settled mutation lease's logical plan owner, authenticated current panel, and
still-current posted native snapshot must agree with that proof. An explicit
manual-change signal retires this evidence; its later receipt cannot restore
it. The accepted observed update and desired-request confirmation occur
transactionally and record a receipt identity or bounded proof digest.
The confirmed observation ID and post-apply epoch/revision remain historical
receipt evidence even after a later edit; they do not replace current freshness.
If retaining the desired request fails, the newly authored unapproved proposal
is removed before it can enter approval or native delivery. A SQLite failure
leaves storage unavailable and current queries nonauthorizing; retaining an
old observed numeric component on disk does not bypass that state.

Failure, timeout, partial mutation, unavailable verification, mismatched
readback or stale evidence does not become confirmed SQL state. AE may already
have changed in a partial or unverified failure. The caller receives that
uncertainty and demands fresh evidence only after the native lane is settled.
The database does not roll back AE, guarantee Undo, or synthesize success.

## Authentication, approval, leases and receipts

The sidecar listens on IPv4 loopback. Mutating HTTP state requires the session
bearer token; collection and native reservation also require the currently
paired panel instance. Provider tool arguments cannot supply executable JSX,
approval identities, lease tokens or substitute native source. The typed
compiler emits deterministic allowlisted commands for the panel.

Approval capabilities bind the exact plan/read set and panel session, expire
and are one-time. Approval is logical authorization. The host scheduler and
the native bridge client separately reserve a durable bridge lease before a
native lane host call and settle it only with the exact captured identity and outcome.
Mutation admission invalidates observations before its acknowledgement.
The logical collection/apply lane and native bridge lane have separate owners.

A wall timeout cannot cancel synchronous ExtendScript or prove its getters or
setters stopped. Cancellation, panel reconnect and sidecar recreation cannot
release a durable native lease. An unresolved lease quarantines further reads,
apply and Undo. A late exact callback can settle the bridge while its abandoned
page remains rejected; settlement does not resurrect stale observations.
Recovery without that callback requires quitting AE and a separately approved
local journal recovery procedure.

Receipts report execution and verification separately. Plan claim and approval
bindings prevent a receipt from inventing execution. Failed, unverified or
partial outcomes retain their vocabulary. A verified relational update must
come from the bounded exact native readback, not a model-authored success claim,
the presence of a receipt, or a snapshot containing the desired value.
`graphSynchronization` reports the SQL outcome separately from the existing
plan receipt. A receipt labeled passed can still fail relational confirmation
when its raw proof is missing, corrupted or retired. The trusted panel is the
native transport boundary; HTTP authentication and exact lease identities do
not provide a cryptographic attestation of an AE getter.

## Migration and performance tradeoffs

`graph-file.ts` verifies the application ID, supported schema version,
`quick_check`, file type, permissions, link count and journal collisions before
opening an existing database for writes. Unknown or damaged files are preserved
and storage becomes unavailable. Version 1's keyset index migration and the
additive version 3 schema migration run in one `BEGIN IMMEDIATE` transaction;
version 2's rows and observations are retained. There is no reset-on-upgrade.

Connections enable foreign keys, disable trusted schema, use DELETE journaling
and FULL synchronous writes, set an 8 MiB cache and cap file pages at 256 MiB.
The sidecar uses synchronous SQLite with a 250 ms busy timeout. Short bounded
transactions and prepared statements keep ownership simple, at the cost of
briefly blocking the sidecar event loop during disk work. Durability and
fail-closed behavior take priority over concurrent write throughput.

Keyset indexes avoid scanning an entire project to return a page. Descriptor
and component relations require small bounded joins/additional reads rather
than duplicating large JSON trees. Legacy node retention is capped at 100,000
rows and pruned by age; retained history and definition growth are also subject
to the file-size ceiling. `maxRows` describes the legacy `nodes` relation; it
does not cap every typed relation or the number of project files.

Accepted property observations also retire superseded native metadata within
the same host, instance binding and parameter definition. The policy retains
the new fact and seven strictly older eligible facts, with at most 64 fact
deletions and 64 orphan-source deletions shared across the whole page transaction.
Referenced provenance, documentation and known defaults remain protected. Equal
or future times relative to the incoming observation are retained. Among strictly
older records, time and source ID select a deterministic retention order; that
order supplies no native freshness or write authority. Backlogs and protected
rows can exceed eight retained facts. Indexed searches limit the scope of work;
the deletion budget does not promise fixed execution time or bound every
candidate examined in a large protected history.

Any desired request in the database, including settled history, disables this
property-metadata pruning. Desired source observation IDs and definition
provenance IDs differ, so absence of a foreign key does not establish that old
evidence is disposable. Requests, desired values, receipts, instances, project
files and native leases are not automatically deleted. A delayed readback still
requires its exact bound current observation; an intervening observation of the
same control can invalidate that binding.

A validated census can remove one exact superseded orphan inventory source per
returned effect, up to its existing 10,000-effect input limit. This prevents new
immediate replacements from accumulating across larger inventories. It does
not sweep preexisting orphan inventory rows, other versions or other hosts.
Five additive provenance indexes install atomically when an existing schema 3
file is reopened, without changing its version or typed data.

The file-size ceiling remains the final limit when protected history grows;
automatic all-domain retention and a global project-file budget remain future
work. Database retention does not restore After Effects or replace native Undo.
Current discovery is demand-driven. No full scan,
continuous perfect mirror, deleted-row reconciliation or real-time performance
claim follows from this architecture.

## Integration evidence

The new `tests/relational-native-*.test.ts` suites use temporary sidecar state and
real SQLite files. Their host fixture models native types, bounds, expression
and keyframe flags, explicit revision changes, values and setters. The actual panel
scheduler/client reserves and settles leases through authenticated HTTP.

Tests cover bounded agent demand, multiple controls, descriptor/value separation,
key times versus expression unknowns, stale/manual edits, approval/native
guards, desired-versus-observed state, confirmed readback, failed confirmation,
and timeout/cancellation/late exact settlement. The unchanged failures-only
runner must report the expected nonzero number of cases. Linux getter latency,
AE queue scheduling, third-party plugin behavior and real-host verification
remain separate evidence requirements.

| Suite | Contract exercised |
| --- | --- |
| [Discovery](../../tests/relational-native-discovery.test.ts) | Bounded real agent demand, descriptor getters, SQL retention, expression/key distinction and stale native stamp |
| [Typed calls](../../tests/relational-native-typed.test.ts) | Real scripted provider/agent, SQL pages/provenance, typed desired request, unknown units, strict range and unsupported adapter |
| [Address identity](../../tests/relational-native-addresses.test.ts) | Repeated native matchNames and exact descriptor identity retained by demand-only value enrichment |
| [Stale edits](../../tests/relational-native-stale.test.ts) | Manual edit before approval and inside the approved native call, before any approved setter |
| [Apply](../../tests/relational-native-apply.test.ts) | Real compiler/approval/lease/native setter/panel verification/receipt/SQL confirmation and partial setter recovery |
| [Receipts](../../tests/relational-native-receipts.test.ts) | Corrupted or absent raw proof, exact approval retry, explicit manual-change invalidation and late proof |
| [Leases](../../tests/relational-native-leases.test.ts) | Timeout/cancel, durable unresolved ownership, exact late settlement and rejection of abandoned pages |
| [Failures](../../tests/relational-native-failures.test.ts) | Whole-page validation atomicity, historical rows versus retired current state and unknown revision |
| [Storage](../../tests/relational-native-storage.test.ts) | Real SQLite write contention, rollback of a new unapproved proposal and unavailable current authority |

[Definition migration tests](../../apps/sidecar/tests/effect-definition-migration.test.ts)
separately exercise v1/v2 row-preserving upgrades, rollback on failed schema
changes, unsafe-file preservation and v3 definition/provenance retention when
reopening with a new store owner. Retained definitions remain queryable while
current instance evidence remains unknown until a new accepted observation.

The root `definition-retention*.test.ts` suites exercise repeated metadata,
shared definitions across native instances, protected provenance/defaults,
clock changes, census sizes beyond a property-page budget, shared deletion
budgets, actual query plans, additive-index migration, desired lineage and
observation rollback. Default `pnpm test`, and therefore `pnpm check`, selects
the maintained root suites together with the existing compiled workspace suites.
