# 0005: Acquire the Adobe SDK manually and keep it local

Status: accepted

## Context

Building the native plugin needs Adobe's After Effects SDK (headers, samples and the PiPL tool). Adobe distributes it
through its Developer Console under its own terms. The repository must stay reproducible without copying proprietary
files.

## Decision

You download the SDK yourself from Adobe's official [developer console](https://developer.adobe.com/console/) and
unpack it anywhere on your machine. Point the build at it with the `AE_SDK_ROOT` environment variable (or the
`-DAE_SDK_ROOT=` CMake option); the build reads it in place and never copies it. A folder named `SDKs/` in the
checkout is git-ignored if you want to keep it there.

No SDK file is committed, scraped, mirrored or redistributed, and none is included in the repository or in any
installer. Never commit authenticated downloads.

## Consequences

The native plugin cannot be built from a fresh clone without an Adobe account and a manual download. Everything
else builds and tests without the SDK: `pnpm test` needs no SDK, and `pnpm check` skips the plugin sources that
include SDK headers when `AE_SDK_ROOT` is not set, and says so.

## Revisit when

Adobe changes how the SDK is distributed or licensed, or when scripting alone removes the need for the native SDK.
