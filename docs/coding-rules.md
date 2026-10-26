# Coding rules

The goal is code a stranger reads once and understands: every name says what it is, every function does one thing, and
nothing needs a comment to make sense. One set of rules covers every language in this repository. `pnpm check` enforces
everything marked **(gate)**; the rest is held in review, with the same weight. [Taste](taste.md) says what the rules
are for, with examples from this repository.

## Languages

- **TypeScript is the only language for code that runs in Node, in the panel, in the build and gate tooling and in
  tests**: `.ts` and `.tsx`. There is no `.js`, `.mjs` or `.cjs` source file. Node runs `.ts` directly through type
  stripping, so the syntax is erasable only (no enums, namespaces or parameter properties), types are imported with
  `import type`, and a relative import keeps its `.ts` extension where Node runs the file directly. Every directory
  that holds TypeScript has a `tsconfig.json` that extends `tsconfig.strict.json` and is referenced from the root
  `tsconfig.json`, so `tsc -b` checks it under the strictest flags.
- **ExtendScript (`.jsx`) is the one exception**, under `apps/panel/host/` and `tools/`. After Effects runs it in an
  ES3 engine, and TypeScript has no ES3 target: it cannot emit code that engine parses without a runtime shim, and the
  shipped text would no longer be the text that is reviewed. `.jsx` is held to the ES5-profile lint, the metric limits
  and the comment rules below instead.
- C++, Objective-C (`.m`) and Objective-C++ (`.mm`), shell (`.sh`, and every extensionless file that starts with a shell
  shebang, such as the macOS `preinstall` and `postinstall` scripts and `plugin/bin/extynt-mcp`), PowerShell and the Inno
  Setup script (`.iss`) are not scripting languages for repository tooling; they exist where the platform requires them
  (the native plugin, the installers). There is no Python and no `.mjs`: the Windows wizard images are rendered by
  `scripts/render-wizard-images.ts` (headless Chrome, then the dependency-free PNG-to-BMP converter in
  `scripts/lib/png-to-bmp.ts`), and the MCP server entry that agent hosts start is `plugin/bin/extynt-mcp.ts`, run by the
  `plugin/bin/extynt-mcp` launcher.
- Build outputs are not sources. `apps/panel/main.js`, `apps/panel/ui-manifest.json` and `apps/panel/gallery-icons.js`
  are produced by `scripts/build-panel.ts`, ignored by git and never edited; every consumer builds first, and
  `panel-integrity` proves that two builds produce the same bytes.

## Principles

1. **Clarity over cleverness, refinement over convenience.** Write the version you would be glad to explain, not the
   first one that works. When two designs pass the tests, choose the one with fewer concepts.
2. **One concept, one place.** A rule, format, limit or name lives in exactly one module. Two copies drift.
3. **Parse at the edge, trust inside.** Host, provider, file and network data is validated once where it enters and is
   typed from then on. Inner code never re-checks what the type already guarantees.
4. **Effects at the edges.** Computation is pure. Clocks, files, sockets, After Effects and models are reached through
   injected dependencies, so the core runs in a test without them.
5. **Efficient by construction.** Pick the right data structure first: a `Map` over a repeated scan, one pass over two.
   Do work once and reuse it by content, not by time. Measure before tuning anything less obvious.
6. **Nothing dead.** No unused exports, unreachable branches, commented-out code, compatibility shims for unreleased
   builds, or switches for features that no longer exist.

## Comments (gate)

- Every file opens with a **header comment**: one to three sentences on what the module is for and where it sits.
- Every **exported** function, class, type, interface and constant may carry **one doc comment** directly above it,
  saying what it guarantees or returns, not how it works. In C++ the doc comment sits on the declaration in the header.
- **No other comments.** Nothing inside a function body, nothing on private helpers, nothing trailing a line, no
  commented-out code. If a line needs explaining, rename it or extract a function whose name is the explanation.
- Tool declarations are not comments and stay where their tool needs them: `/* global */` and `/* exported */` in
  `.jsx` headers, `# shellcheck source=` directives. Runtime prompt strings are data.

## Naming

- Names use the domain's words: `layer`, `keyframe`, `plan`, `receipt`, `snapshot`. Functions are verbs
  (`readLayer`), predicates are questions (`isLocked`, `hasKeyframes`), values are nouns.
- No vague names: `data`, `info`, `item`, `obj`, `value`, `result`, `tmp`, `helper`, `util`, `manager`, `handler` and
  `process` are never a whole name. No `utils`, `helpers` or `misc` files.
- No abbreviations beyond the established ones: `id`, `url`, `json`, `ae`, `mcp`, `llm`, `ms`, `px`.
- An untyped quantity carries its unit: `timeoutMs`, `durationSeconds`, `widthPx`.
- A file is named after the one thing it provides, in kebab-case for TypeScript and ExtendScript and snake_case for C++.
- Casing: camelCase values and functions, PascalCase types, SCREAMING_SNAKE_CASE module constants and environment
  variables. C++ follows the Google style that `.clang-format` and clang-tidy enforce.

## Functions

- One function does one thing at one level of abstraction. Most functions fit in 20 lines; 40 is the limit (gate).
- Guard clauses first, the main path last and unindented. Prefer early return to `else` after a return.
- No boolean parameters that switch behaviour: write two functions, or take a named option with a union type.
- Return new values instead of mutating arguments. Mutation is local and visible, never across a call.
- When the cases are data, use a table, not a ladder of `if` or `switch`.
- Errors are handled once, where something can be done about them. Never swallow an error silently: a `catch` either
  rethrows, converts to a typed result, or returns a named fallback the caller can tell apart.
- `async` only when the function awaits. Independent awaits run together with `Promise.all`.

## Types and data

Everything is typed exactly. The type system describes what the program knows, and a value's type is never weaker than
what the code has already checked.

- **No `any`, anywhere** (gate): not explicit, not implied, not through a library type.
- **No escape hatches** (gate): no `as` casts except `as const`, no non-null assertions (`!`), no double assertions, no
  `object`, `Function`, `{}` or `Record<string, unknown>` as a stand-in for a shape, no index signatures where the keys
  are known.
- **`unknown` lives only in `packages/decode/src`** (gate). No other TypeScript file writes the `unknown` keyword: not a
  decoder or type-guard parameter, not a `catch` annotation (an implicit `catch (error)` binding has no keyword), not a
  callback parameter, field, return value, variable, generic default or `Record<string, unknown>`. Foreign input is
  taken only by `@extynt/decode` functions; everything else receives decoded, precise types.
- **Boundaries are explicit.** Data enters the program in a few places: HTTP requests, MCP tool calls, the native
  plugin protocol, ExtendScript results, model responses, environment variables and files on disk. Each boundary
  decodes its input with `@extynt/decode` into a precise type, and rejects what doesn't fit with a typed error that
  names the field. Past the decoder, nothing re-checks.
- **Loosening at a boundary is a decision, not a convenience.** A decoder may accept a wider input than the program
  needs, for example tolerating unknown extra fields from a newer plugin or keeping an opaque passthrough payload as a
  branded `RawJson` string, when that is the correct contract with the other side. Say so in the decoder's doc comment.
- **Make illegal states unrepresentable:** discriminated unions instead of objects full of optional fields, branded
  types for identifiers that must not mix (`LayerId`, `CompositionId`, `PlanId`), and literal unions instead of strings
  with documented values.
- Inputs and shared data are `readonly`. Collections are `ReadonlyArray`, `ReadonlyMap` and `ReadonlySet` at
  boundaries.
- `undefined` means "not given"; `null` means "known to be absent". A module doesn't use both for the same thing.
- Constants that belong together are one `as const` object or one table, not scattered literals.
- The compiler runs at its strictest: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns` and `noFallthroughCasesInSwitch`.
  The gate enforces them everywhere; the build enforces them for a project that extends `tsconfig.strict.json`.
  A project opts in as soon as it typechecks clean, and the gate fails a clean project that has not.

**C++ follows the same idea.** No `void*`, no `std::any`, no C-style casts, no unions read through the wrong member,
no C varargs, and no `reinterpret_cast` or `const_cast` (gate). The one boundary is the platform: the Adobe SDK, Win32,
Cocoa and the socket API. Platform handles and C structures are wrapped once, in **platform wrapper files named
`sdk_*.{h,cpp,mm}`** inside `ae/`, `transport/` or `catalogue-window/`, by typed RAII owners and typed accessors. Only
those files may do what the platform forces, and they say so honestly instead of hiding it:
- `reinterpret_cast` and `const_cast` where a platform API takes or returns the wrong type;
- `void*` only as the exact parameter type a platform function declares, or as the local out-parameter it fills
  (`void* raw = nullptr;` inside a function, its address passed on), never a member, alias, return type or stored;
- a C varargs call only to the platform function itself (`open`), never to forward arguments; `va_list`, `va_start` and
  `__VA_ARGS__` appear nowhere else;
- a function signature the platform fixes (an AEGP entry point, a Win32 window procedure), which may exceed the
  parameter limit; it forwards at once to a function taking one struct.
Accessors are concrete and named for what they read (`layerHandle(LayerRef)`, `dpiSuggestedRect(LPARAM)`,
`asSockaddr(const sockaddr_in6&)`): no generic cast template such as `payload<T>(LPARAM)`, because nothing would tie
the message to its payload type. A trait, macro or `memcpy` that exists only to avoid writing a banned token is the
banned token. clang-tidy runs on wrapper files with every check on except the cast and vararg checks this list allows.
Protocol JSON is decoded into structs or `std::variant` at the transport edge and is never
passed around as a generic tree. Identifiers and units that must not mix get their own types, and enumerations are
`enum class`.

## Modules

- A module has a small, deliberate export surface. Package roots re-export their public API; nothing else is a barrel.
- Dependencies point one way and never form a cycle (gate).
- Tests follow every rule here, header comment and no body comments included. A test name is a sentence about
  behaviour, and one test checks one behaviour.

## Limits (every language, gate)

There is no exception mechanism: no baseline file, no per-file allowlist, no suppression comment. A file or function
that cannot meet a limit is split along a real boundary.

| Limit | Value |
| --- | --- |
| Logical lines per file | 400 |
| Logical lines per function | 40 |
| Cyclomatic complexity per function | 8 |
| Nesting (nested control statements) | 3 |
| Parameters | 4; more means one typed parameter object (C++: one struct) |

Tests, fixtures, tools and scripts are held to the same numbers.

**Line length** is capped at 160 characters by ESLint `max-len` (an error) in `tools/**`, `scripts/**` and the root `tests/**`, and in every `.jsx` file. The rule ignores
URLs, string literals and template literals, because a literal cannot be wrapped without changing it or hiding it from search; it does not ignore regular
expressions or comments. It covers `.ts` and `.tsx`, not `.jsx`. `apps/**` and `packages/**` are not under the cap yet; they come under it in phase 3.

Definitions, per language:

- **TS, TSX, JSX**: a logical line is a line occupied by at least one token (multi-line tokens count on every line). Complexity is counted exactly as ESLint's `complexity` rule counts it. Nesting counts nested loops, `if`, `case`, `catch`, `?:` like ESLint `max-depth`. Measured by `scripts/lib/measure.ts`.
- **C++, Objective-C, Objective-C++**: lizard NLOC (non-blank, non-comment lines) and lizard CCN (`if`, `for`, `while`, `case`, `catch`, `?:`, `&&`, `||`). Parameters are lizard's parameter count; a single struct parameter is the parameter-object form. Nesting is owned by clang-tidy `readability-function-size` (`NestingThreshold: 4`, because clang-tidy counts the function body as level 1, so the limit is three nested control statements, the same as TS/JS). lizard owns length, complexity and parameters; clang-tidy owns nesting only (its other size thresholds are off, so nothing is counted twice).
- **Shell**: no numeric limits; shellcheck at `style` severity.
- **Inno Setup (`.iss`)**: `scripts/lib/inno-rules.ts` reads the file with a small Pascal-aware lexer (`scripts/lib/inno-lexer.ts`) and applies the shared limits. The file is at most 400 non-blank, non-comment lines. Every `[Code]` routine (a `function` or `procedure` at column 0 up to its `end;` at column 0) has at most 40 such lines, 4 parameters (counted per name, so `A, B: String` is two), complexity 8 and nesting 3. Complexity is 1 plus the count of `if`, `while`, `for`, `until`, `and`, `or`, `except` and `case` outside strings and comments; it also counts `or` between flags, so it can over-count and never under-counts a branch. Nesting is the deepest stack of `begin`, `try`, `repeat` and `case` blocks inside the routine's own `begin`; a one-statement `if` without `begin` is not counted. The sections outside `[Code]` (`[Setup]`, `[Files]`, ...) are data and are held to the file length and the comment rule only.

## Excluded code

Only code that is not ours is excluded, and each exclusion is one entry with its reason in `scripts/lib/sources.ts`: `native/extynt-core/third_party/**` (vendored xxhash), and `native/extynt-core/tests/syntax-check/stubs/**` (stubs that mirror Cocoa, WebKit and macOS shim APIs). Nothing else.

## File types the rules do not measure

Every tracked file type, and why it is or is not under the limits. Nothing here is a baseline or an allowlist: a type is listed as unmeasured only when it holds no logic, or when no tool for it is installed yet.

| Type | Status |
| --- | --- |
| `.ts`, `.tsx`, `.jsx` | Measured: metrics, comments, header, lint, typecheck. |
| `.cpp`, `.h`, `.mm`, `.m` | Measured: lizard, comments, header, clang-format, banned tokens. clang-tidy and the SDK syntax check run on `native/extynt-core` core, transport, tests and `ae/*.mm`; `.m` files under `packaging/macos` get lizard (length, complexity, parameters) but no clang-tidy, so nesting is not checked there. |
| `.sh`, extensionless shell | Measured: shellcheck, header and strict mode, comments, banned tokens. No numeric limits for shell. |
| `.ps1` | Measured: PowerShell rules, comments, header. |
| `.iss` | Measured: see the Inno Setup definition above. |
| `.css` | Declarative: selectors and custom properties, no logic. No linter is installed, so nothing checks it beyond whitespace. |
| `.rc`, `.r`, `.plist`, `.plist.template`, `.plist.in`, `.xml`, `.json`, `.yaml`, `.env`, `.sql`, `.txt` data | Declarative or data: a one-line icon resource, the PiPL resource with `#ifdef` selection, property lists, installer XML, manifests, a SQL schema fixture. No logic. |
| `.html` | Markup, except inline `<script>` bodies: `apps/panel/gallery.html` (a dev-only design gallery, about 55 lines of ES5), `packaging/windows/branding/wizard.html` (3 lines) and `packaging/macos/release/branding/background.html` (1 line). Those scripts are not measured; the gallery's is the one real gap. Moving it into a measured TypeScript file needs a build step that is not written yet. |
| `.cmake`, `CMakeLists.txt` | Code (conditions, functions) that is not measured. Four files, each under 100 lines except the 216-line root list. A cmake linter (the `cmakelang` pip package) would be the dependency to add; it is proposed, not installed. |
| `.ffx`, `.png`, `.bmp`, `.ico` | Binary assets. |

## The product name

The product name is always lowercase `extynt`: in UI text, menu and panel titles, docs, logs, messages and comments, including at the start of a sentence. Code identifiers are lowercase-first (`extyntPanel`, `extyntWebView`), the plugin is `extyntcore` (`extyntcore.plugin`, `extyntcore.rsrc`, `extyntcore_PiPL.r`), and filesystem paths are lowercase (`/Library/Application Support/extynt`, `Plug-ins/extynt`, `~/Documents/extynt`). ALL-CAPS constants and environment variables (`EXTYNT_*`) keep their form. The `banned-tokens` stage fails the capitalised spelling in the product sources (`apps/sidecar/src`, `apps/panel/runtime`, `apps/panel/host`, `packages/*/src`, `native/extynt-core/**/*.{cpp,h,mm}`). Tests may name it to assert that.

## Suppressions are banned

The `banned-tokens` stage fails on `NOLINT*`, `eslint-disable*`, `eslint-enable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` and `shellcheck disable` in any maintained file. A `# shellcheck source=` directive only tells shellcheck where a sourced file lives and is allowed. The same stage scans `apps/panel/runtime/**` for `__adobe_cep__`, `cep.fs`, `evalScript`, `CSInterface`, `getSystemPath`, `localStorage`, `sessionStorage`, `indexedDB`, `alert(`, `confirm(` and `prompt(` (comments and strings included): the panel runs in the native host, keeps nothing in the page and opens no modal dialog. A check may be disabled in exactly one place per tool: `native/extynt-core/.clang-tidy`, with a one-line reason in its header table. Keep that list short.

## TypeScript and TSX

- ESLint (`eslint.config.ts`) plus the metric gate. Errors: `no-explicit-any`, the type-aware `no-unsafe-*` rules, `no-non-null-assertion`, `consistent-type-assertions` with `assertionStyle: "never"` (so only `as const` is a legal assertion), `no-restricted-types` for `object`, `Function`, `{}`, `Record<string, unknown>` and `Record<string, any>`, and `use-unknown-in-catch-callback-variable`.
- `tsconfig.base.json` sets `strict` and `noUncheckedIndexedAccess`; `tsconfig.strict.json` extends it with `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns` and `noFallthroughCasesInSwitch`. A project's `tsconfig.json` extends `tsconfig.strict.json` to opt in.
- Import direction and cycles are checked by `scripts/lib/import-graph.ts`.
- Time: durations use a monotonic source or a backwards-clock guard; never use locale case mapping for identity.

## ExtendScript (`.jsx`)

- Parsed as **ECMAScript 5** (`ecmaVersion: 5`, script). ExtendScript is ES3 plus leniencies; two validation probes already depend on reserved words as property names (`row.static`, `report.enum`), which an ES3 parser rejects, so ES5 is the floor the gate can parse. Everything ES5 adds that ExtendScript lacks is banned: `let`, `const`, arrows, classes and template strings do not parse; getters/setters in object literals, trailing commas (`comma-dangle: never`), `Array.prototype.forEach/map/filter/reduce/reduceRight/some/every`, `String.prototype.trim`, `Function.prototype.bind`, `Array.isArray`, `Object.keys/create/defineProperty/defineProperties/freeze/getPrototypeOf` and `Date.now` are lint errors. `Array.prototype.indexOf` cannot be told from `String.prototype.indexOf` by syntax: search arrays with a loop.
- A top-level IIFE statement (`(function () { ... })();`) is the ES3 module pattern. It is measured as the file (400 lines), not as a function; its inner functions are measured normally.
- `no-undef` runs against an explicit host-global list in `scripts/lib/jsx-lint.ts` (the After Effects DOM classes and enumerations the code uses, plus the ExtendScript runtime: `$`, `alert`, `confirm`, `prompt`, `system`, `File`, `Folder`, `Window`, `UnitValue`, `isValid`). A name another file defines is declared with `/* global name */`, and an entry point called from outside the file (a function or a variable) with `/* exported name */`, both in the leading comment block at the top of the file only. Each exported function or variable carries one doc comment directly above it. These are declarations, not suppressions.
- Also errors: `no-unused-vars`, `eqeqeq`, `no-redeclare`, `no-shadow`, `no-eval`, `no-with`, `no-implied-eval`, `no-new-func`, `no-caller`, `no-proto`, `no-sequences`, `no-throw-literal`, `no-fallthrough`, `no-self-compare`, `no-unreachable`, `default-case`, and `curly: multi-line` (a braceless single-line body is fine, a multi-line body needs braces).
- **`$.evalFile` is allowed only outside functions.** After Effects evaluates `$.evalFile` inside a function in that function's scope, so the library's declarations vanish. Load siblings with top-level statements.

## C++ and Objective-C++ (`native/extynt-core`)

- Pinned tools (`scripts/requirements-tools.txt`, installed by `pnpm setup:tools` into `.tools/venv`, looked up there first and then on `PATH`): lizard, clang-format, clang-tidy, shellcheck. A missing tool fails the gate with the setup command. cmake and a C++ compiler are required whenever `native/extynt-core` exists.
- **Format**: `.clang-format` (Google base, 120 columns); `clang-format --dry-run -Werror` over every owned `.cpp`, `.h`, `.mm`.
- **clang-tidy** (`.clang-tidy`): `bugprone-*`, `cert-*`, `clang-analyzer-*`, `concurrency-*`, `cppcoreguidelines-*`, `misc-*`, `modernize-*`, `performance-*`, `portability-*`, `readability-*`, all errors. Run on `core/`, `transport/` and `tests/` with the compile database of a clang CMake configure.
- **macOS clang-tidy**: the script sets `SDKROOT` from `xcrun --show-sdk-path` when it is unset (the pinned pip clang-tidy does not find the SDK's libc++ headers alone) and, on darwin only, runs with `.clang-tidy` plus a header mapping (`scripts/lib/native-darwin.ts`, written to `.check-logs/clang-tidy-darwin.yaml`). Apple's SDK defines POSIX types and functions (`ssize_t`, `socklen_t`, `sigset_t`, `htons`, `open`, `O_*`, `pthread_sigmask`) in private sub-headers, and `TRUE`/`FALSE` in `MacTypes.h`, so `misc-include-cleaner` names headers nobody includes or calls `<sys/types.h>` and `SPTypes.h` unused. The mapping adds only those Apple sub-headers and umbrella headers to `misc-include-cleaner.IgnoreHeaders`; the check stays on, Linux uses `.clang-tidy` unchanged, and nothing is suppressed in source. On Linux, `.clang-tidy` carries the equivalent mapping for glibc: `bits/.*` and `asm-generic/.*` (private sub-headers) plus `signal.h`, `csignal` (macOS needs it for `kill`, and glibc attributes `kill` to the ignored `signal.h`), `sys/poll.h`, `stdlib.h`, `sys/wait.h` and `sys/time.h`, because glibc defines `WNOHANG`, `WIFEXITED`, `WEXITSTATUS` and `struct timeval` in `bits/` headers that `misc-include-cleaner` attributes to `<stdlib.h>` or to nothing; source includes the POSIX header it means (`<sys/wait.h>`, `<sys/time.h>`) and uses the macros directly. The Objective-C++ syntax check against the stand-in Cocoa is Linux-only (its GNUstep runtime cannot target Mach-O); the Mac build compiles `ae/*.mm`.
- **Warnings**: every target (core, transport, tests, plugin, syntax check) builds with `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wsign-conversion -Wnon-virtual-dtor -Wold-style-cast -Woverloaded-virtual -Wnull-dereference -Wdouble-promotion -Wformat=2 -Wimplicit-fallthrough -Wcast-align -Wunused -Werror`. Unused parameters are unnamed or `[[maybe_unused]]`. SDK and `third_party` headers are `SYSTEM` includes. Objective-C++ builds with `-fobjc-arc -Wobjc-missing-super-calls`. `build-mac.sh` goes through the same CMake flags, so the Mac build fails on warnings too.
- **Sanitizers**: the gate builds and runs the C++ tests twice, Release and Debug with `-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all` (CMake option `EXTYNT_SANITIZE`).
- **Include architecture** (`scripts/lib/cpp-rules.ts`): `core/` includes only `core/`, `third_party/xxhash` and the C++ standard library (no POSIX, OS or SDK headers); `transport/` includes `core/` plus POSIX and system headers, never `ae/`; `tests/` include `core/`, `transport/` and their own helpers, never `ae/` or SDK headers; `ae/` may include anything. A file that lists the same include twice fails, in Windows files too.
- **`ae/` cannot be built on Linux.** It is syntax-checked and clang-tidied against the SDK headers (read in place from `AE_SDK_ROOT`, never copied) and the Cocoa stubs by `native/extynt-core/tests/syntax-check/check-ae-syntax.sh`. Without `AE_SDK_ROOT` the stage reports that the `ae/` and Windows checks were skipped and still passes, so a clone without the SDK runs the whole gate; an `AE_SDK_ROOT` that names a missing directory fails. The Mac and Windows builds cover `ae/` there. The Windows pass runs clang-tidy against mingw-w64 with `readability-duplicate-include` and `misc-include-cleaner` off (they mis-fire on mingw headers), so missing or unused includes in the Windows files are not checked; duplicate includes are, by the architecture stage.

### After Effects host boundary

1. **No C++ exception crosses into After Effects or Cocoa.** Every registered AEGP entry point, idle hook, command hook, panel callback and death hook is `noexcept` and catches everything (`catch (...)`) at its boundary. `bugprone-exception-escape` and a source check in the architecture stage enforce it for the registered `.cpp` callbacks; Objective-C methods Cocoa calls catch inside.
2. **No raw owning `new`/`delete` or `malloc`/`free`.** AEGP memory handles and other SDK resources are owned by RAII wrappers. `cppcoreguidelines-owning-memory` and a token ban enforce it.
3. **AEGP suites are called only on After Effects' main thread** (idle hook, command hook). The socket thread never calls them, and `transport/` never includes `ae/`.
4. **Nothing on After Effects' main thread blocks or runs a nested event loop.** Banned in `ae/**`: `runModal`, `runModalForWindow`, `beginSheetModalForWindow`, `NSAlert`, `sleep`, `usleep`, `nanosleep`, `sleep_for`, `sleep_until`, `dispatch_sync` (a synchronous hop onto the main queue can deadlock the main thread), `nextEventMatchingMask`. WebKit's autocorrect bubble running a nested loop stalls the idle hook for as long as it is open. For the same reason the **web panel must not use `alert`, `confirm`, `prompt`, file pickers or autocorrect popups**.

## Shell

Every `*.sh` begins `#!/usr/bin/env bash` (`#!/bin/sh` only if it must be POSIX) and its first statement is `set -euo pipefail` (`set -eu` for sh). Pinned shellcheck at `--severity=style` must report nothing. Express intentional word splitting with arrays and intentional unset variables with `${VAR:-}`; do not suppress.

## Gate stages

`pnpm check` runs, one PASS or FAIL line each: `tools`, `architecture` (TS imports, C++ includes, AE callback boundary), `panel-integrity`, `metrics` (TS, TSX, JSX), `comments`, `header-length`, `dead-exports`, `unknown-boundary`, `native-metrics` (lizard for C++, Objective-C and Objective-C++; the `.iss` rules), `whitespace`, `format` (clang-format), `banned-tokens`, `shell` (shellcheck, headers, PowerShell rules), `build`, `lint` (ESLint including `.jsx`), `typecheck`, `workspace-tests`, `headless-validation`, `native-core` (tool tests, Release ctest, sanitizer ctest, clang-tidy, AE syntax check). It stops at the first failure; `--keep-going` runs every stage anyway.

`pnpm build` ends with `scripts/prune-stale-build.ts`, and `pnpm test` runs it again before the full suites: compiled files under a package's `dist/src` or `dist/tests` whose TypeScript source was renamed or deleted are removed, so a merge never needs a manual `rm -rf dist`. `run-tests.ts` still refuses an explicitly named compiled test with no source (`STALE compiled test`).

- `--only metrics,comments` runs the named stages.
- `--paths 'apps/sidecar/src/**,packages/{llm,workflow}/src/**'` limits the file-based stages (`metrics`, `comments`, `header-length`, `dead-exports`, `native-metrics`, `whitespace`, `format`, `banned-tokens`, `shell`, `lint`) to matching repo-relative files. Several globs may follow one `--paths` (`--paths 'apps/sidecar/**' 'packages/llm/**'`), and the option may repeat; each argument may itself be a comma list. `*` stays inside a directory, `**` crosses directories, `{a,b}` lists alternatives, and a bare directory matches everything under it. Whole-repository stages ignore it. Iterating on one area: `node scripts/check.ts --only metrics,comments,dead-exports,lint --paths 'apps/sidecar/**' --keep-going`.
- **`comments`** (`scripts/lib/comment-rules.ts`, one module per language family under `scripts/lib/comments/`) implements the comment policy above with real tokenizers, so comment-like text in strings, template literals and regular expressions is never mistaken for a comment. TS, TSX, JS and MJS use TypeScript's AST trivia: the first comment is the header (after a shebang), and every other comment must end on the line directly above a top-level exported declaration (`export` declaration, `export default`, `export { ... }`); trailing comments, body comments, comments on private declarations and a second comment on one declaration fail. `.jsx` allows the header, `/* global */` and `/* exported */` declarations, and one doc comment directly above each top-level function or variable named in `/* exported */`. C++ and Objective-C++ use a small lexer: every file needs a header comment; in `.cpp`, `.m` and `.mm` that is all; in `.h` a doc comment must sit directly above a declaration at namespace or class scope, never in a function body or an enumerator list. Inno Setup scripts need a header block of `;` lines before the first directive or entry; the only other comments are one `{ ... }` block directly above a `[Code]` routine, never in a section, a `var` list or a routine body. Shell and PowerShell need a header block before the first statement (after the shebang and the `set` line, `Set-StrictMode`, `#requires`), may carry one comment block directly above a function, and always allow `# shellcheck source=` directives.
- **`unknown-boundary`** (`scripts/lib/unknown-boundary.ts`) parses every TS and TSX file and fails each `unknown` type keyword outside `packages/decode/src`, as `file:line: reason`, with a per-area count first. Nothing else is allowed: decoder and type-guard parameters, annotated `catch` bindings and `.catch`/`.then` callbacks fail like any other use; an implicit `catch (error)` has no keyword and passes. Exported types or fields carrying `unknown`, `unknown` variables and returns, `Record<string, unknown>`, `unknown[]`, a generic default of `unknown` and `<T extends unknown>` all fail.
- **`typecheck`** (`scripts/lib/typecheck.ts`) builds a generated strict layer (`.check-logs/strict`, one tsconfig per project extending the project's own and `tsconfig.strict.json`) with `tsc -b`, whether or not the project opted in, and prints the error count per area and per error code, a line listing the projects that opted in, then the errors. It also fails a project that has no strict errors but has not extended `tsconfig.strict.json`.
- **Census**: `node scripts/census.ts` prints, per area (`apps/sidecar`, `apps/panel/runtime`, `apps/panel/tests`, each `packages/*`, each `tools/*`, `scripts`, `tests`), the counts of `any`, casts, non-null assertions, restricted types and `unknown` violations, and per native directory (`ae`, `core`, `transport`, `catalogue-window`, `tests`) the counts of `void*`, `std::any`, `reinterpret_cast`, `const_cast` and `union`. It also prints a header-length report: the count per area, then one line per file whose opening comment is longer than 12 lines (the list is omitted when no file is over). The census itself only reports; the `header-length` stage is what fails.
- **`banned-tokens` for native code** also fails `void*` and `std::any` (and `<any>`) in every owned C++ file, and the C `printf` and `scanf` families (any mention of `snprintf`, `sprintf_s`, `wsprintfW` and the like, not only calls), `va_list`, `va_start` and `__VA_ARGS__`, and `reinterpret_cast` and `const_cast` in every owned C++ file except the platform wrapper files `native/extynt-core/{ae,transport,catalogue-window}/sdk_*.{h,cpp,mm}`. In those, `void*` is allowed only as a named parameter of a declared function or as a local `void* name = nullptr;` inside a function whose address is passed on; a member, a `case`-label declaration, a `sizeof` operand and any other use fails.
- **clang-tidy exceptions for the wrappers.** `performance-no-int-to-ptr` stays enabled everywhere except the `sdk_*` wrapper configuration, because the platform handles there (HWND, FARPROC, refcon) are integer-to-pointer conversions by contract. `cppcoreguidelines-pro-type-union-access` is allowed in `sdk_bits.h` only. The wrapper configuration also relaxes the reinterpret-cast, const-cast, C-style-cast and vararg checks, and its header filter is `(ae|transport|catalogue-window)/sdk_*.h`.
- **`header-length`** (`scripts/lib/census.ts`) fails every maintained file whose opening comment is longer than 12 lines, as `file: header is N lines (cap 12)`. The block counts from its first line to its last, whatever the language; in `.jsx` the `/* global */` and `/* exported */` directives are not the header.
- **`dead-exports`** (`scripts/lib/dead-exports.ts`) parses every maintained TS and TSX file, resolves relative imports, workspace package names and `dist/` paths back to source, and fails an export in a workspace package's `src/` (or the panel's `runtime/`) that no other module, test or package imports. Everything a `package.json` `exports`, `main`, `module` or `types` entry exposes counts as used, `export *` and `export { x } from` forward usage to the original, and a namespace or dynamic import keeps every export of the module alive. The same stage runs one `tsc -b` pass over a generated layer with `noUnusedLocals` (`.check-logs/unused`, `scripts/lib/unused-locals.ts`) and counts the locals, imports and type parameters nothing reads, per area. An area listed in `CLEAN_AREAS` in that module is already at 0, so a new unused local there fails the stage; every other area only prints `unused locals (warning): area=count`, and joins `CLEAN_AREAS` when a sweep brings it to 0.

## Gate protocol and rationale

The guardrail scope is every hand-maintained source file in the worktree, root-level scripts and configuration included, plus whole-worktree whitespace validation that also covers untracked files. Run `pnpm check` before handing off work. `pnpm setup:tools` installs the pinned native and shell tools into `.tools/venv`; a missing tool fails the gate with that command. Successful output is deliberately quiet: one PASS line per gate with duration and test counts. Full command output is stored under the ignored `.check-logs/`; the path and a focused tail are printed only for a failure. Type-aware lint resolves cross-package types through built declarations, so the build precedes it.

**Test output protocol.** Every test invocation routes through `scripts/run-tests.ts` (`node scripts/run-tests.ts <test-file...>`); that is what each package's `pnpm test`, the root `pnpm test` and the `headless-validation` gate call. The runner installs `scripts/test-reporter.ts`, which prints failures only: a green run is a single line (`tests=N pass=N fail=N skipped=N todo=N duration=...`), a red run prints each failure's message and stack plus any skipped test, then a `FAILED:` recap naming every failing test. Do not run bare `node --test` in a transcript: the default spec reporter prints every passing test and buries the defect. When a green run's own output is genuinely needed, re-run that one file with `--test-reporter=spec`; never change the shared scripts to get more output. The live decision suites are the one exception to the reporter: `pnpm test:live` (`node scripts/run-tests.ts --live`) runs only `LIVE_TEST_PATTERNS` with the spec reporter, because each suite prints its accuracy on every run. The gate's test environment never carries a model key; `testEnvironment` in `run-tests.ts` is the only place that decides it, and `liveTestEnvironment` adds the key for the live mode alone. Every suite runs with the repository root as its working directory, so tests may read repo-relative paths such as `apps/panel/main.js`; never add a path that assumes the package directory.

**Measurement.** `scripts/lib/measure.ts` is the single measurement implementation. ESLint reports the same structural limits as warnings for the developer and `scripts/check.ts` enforces them as hard failures, together with dependency direction, cycles, generated-file integrity, unsafe-syntax bans and file size. Complexity is counted exactly as ESLint's `complexity` rule counts it: branches, `&&`/`||`/`??`, logical assignment, every optional-chain link, and every default value in a parameter or binding pattern. A logical line is a line occupied by at least one token; a multi-line token such as a template literal counts on every line it spans. The same limits apply to every maintained file, tests and fixtures included.

**Maintained set.** Every tracked or untracked-but-unignored `*.ts`, `*.tsx`, `*.jsx`, `*.cpp`, `*.h`, `*.mm`, `*.sh` and `*.ps1` file, excluding `dist/**`, `node_modules/**`, `.check-logs/**`, `.tools/**` and git-ignored build output. `scripts/lib/sources.ts` decides it and lists the only excluded code with its reason: vendored third-party code and the Cocoa/WebKit stubs under `native/extynt-core/tests/syntax-check/stubs`. `apps/panel/main.js` is a git-ignored build output generated from the fully checked TypeScript under `apps/panel/runtime/`; `scripts/build-panel.ts` is the only bundling step and the gate verifies byte-for-byte deterministic output.

**The bundle is a text contract.** `scripts/build-panel.ts` emits each module through `stripTypeScriptTypes`, which replaces TypeScript syntax with spaces in place, so a type annotation on a declaration (`var X: T = {` becomes `var X            = {`) and a non-null assertion both change the shipped text. That text is asserted in `apps/panel/tests/**`, `packages/mcp-server/tests/**` and `packages/capability-catalogue/tests/native-operations.test.ts`; anyone editing `apps/panel/runtime/**` runs all three. Inside a statement that a bundle-text assertion pins, add neither a type annotation nor a non-null assertion.

**No exceptions.** A file or function that cannot meet the limits is split along a real domain boundary, never recorded as debt, re-anchored, renamed or grandfathered. The architecture check rejects every runtime import cycle (strongly-connected-component analysis; type-only imports are not edges). Explicit `any`, `as any`, `as never`, `as unknown as T` and other double assertions, and unchecked casts of provider, host or JSON data are not permitted.

**Small structural guards** (a 1-3 line `isRecord`/`recordOf`/`asRecord` narrowing guard) are a per-module idiom: repeat once per module rather than hoisting into a shared module, and never share one by importing against the package dependency direction or by introducing a cycle. Consolidate only when the duplicated logic is substantial enough that the copies could drift. A deliberate mirror of production logic inside a test, to detect drift, is a feature.

**Clocks and locale.** `Date.now()` and `new Date()` produce timestamps; `toISOString()` is the wire and receipt format. A duration uses a monotonic source or an explicit backwards-clock guard (`boundedHostHopMs` in the panel is the reference; its `Date.now()` basis is pinned by a shipped test). Never use a locale-dependent case mapping such as `toLocaleLowerCase` for matching or identity; `toLocaleTimeString`, `toLocaleString` and `getHours` are for display only and never feed a receipt, fingerprint or wire payload. Prefer the injected clock (`deps.now()`) in anything a test controls.

**Fake host.** The fake host never claims an operation it did not model, and the fake panel preserves the real ordering: sealed batch, claim, approval, host dispatch, receipt, fresh snapshot. These are harness contracts, not evidence of a real After Effects result; real-host validation remains a separate explicit gate.
