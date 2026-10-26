# Contributing to extynt

Thanks for helping. extynt is MIT-licensed and early, so small, focused changes are easiest to review.

## Setup

You need Node.js 26 (the LTS line from late October 2026; 26.12.1 or newer) and pnpm 10.

```sh
pnpm install
pnpm build           # compiles every package, then bundles the panel
pnpm test            # builds and runs all tests; needs no After Effects
node scripts/check.ts   # the full gate, the same as `pnpm check`
```

`pnpm setup:tools` installs the pinned native and shell tools (clang-format, clang-tidy, lizard, shellcheck) into
`.tools/`. The gate's native and shell stages need them; install them once before running the gate.

**The Adobe After Effects SDK is manual.** It is not in this repository and is never redistributed. Download it from
Adobe, unpack it anywhere (for example into the git-ignored `SDKs/`) and set `AE_SDK_ROOT` to the folder that contains
`Examples/`. Without it the gate skips the plugin sources that include SDK headers and says so
([ADR 0005](docs/decisions/0005-manual-adobe-sdk-acquisition.md)).

**Live decision-model tests are opt-in.** `pnpm check` and `pnpm test` are fully offline: they never read a key, never
call a model, and report the live suites as skipped. `pnpm test:live` runs only the suites that call the real Jev
service. It takes the key from `TYPESAFE_API_KEY` in the environment, or else from `~/.config/extynt/jev.env`, and never
prints it. Model answers vary, so each live suite reports its accuracy and passes when that reaches the minimum set in its
file; a wrong answer is printed as a miss, not a failure. Latency and "the suite asked the model nothing" still fail
outright. With no key, or with a rejected key or an unreachable server, the suites are skipped with the reason.
Everything else uses fakes.

## Rules

- Read [docs/taste.md](docs/taste.md) first: what good code looks like here, with real examples. Then
  [docs/coding-rules.md](docs/coding-rules.md), the limits for every language (TypeScript, ExtendScript, C++,
  Objective-C++, shell) enforced by the gate with no exceptions.
- Every commit must pass the full gate and `pnpm test`. Do not suppress a gate failure; split the code along a real
  boundary instead.
- Comments say what a module or an export guarantees, never its history, and never appear inside function bodies.
- Add or update tests with the change. Tests state behaviour. Fixtures are synthetic; do not commit projects, footage
  or recordings of real work.
- Do not commit data about third-party plugins (effect lists, parameter tables, match names collected from a machine).
  The effect catalogue is collected at run time on the user's own machine.
- Do not commit Adobe SDK files, signing identities, API keys, personal names, hostnames or absolute paths from your
  machine.
- The only network traffic is to the model and decision-model providers the user configures. Do not add telemetry,
  update checks or other calls home.
- An unsigned local build must always work. Signing runs only when you supply your own identity through the
  environment. `pnpm check` and `pnpm test` must pass on a clean clone without After Effects.
- Commits are authored `extynt <hello@extynt.com>`. Use placeholders such as `alice`, `/Users/you` and `YOUR_TEAM_ID`
  in code and docs.

## Commits and pull requests

Write the commit subject as what the code does now ("Route: take a model answer only in the act band"), one change per
commit. Keep each pull request to one change, describe what it does and how you checked it, and say whether you tested
on real After Effects (and which version) or only with the automated tests.

By contributing you agree that your work is released under the [MIT License](LICENSE).
