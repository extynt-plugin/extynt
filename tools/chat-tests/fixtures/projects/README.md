# Real-project benchmark intake

This directory holds manifests and sanitized derivatives, not source After Effects projects. `.aep`, `.aepx`, footage, fonts, renders, and client material remain local unless their license and review explicitly permit committing them.

For each project, provide a folder outside the repository containing:

1. the `.aep` or `.aepx` project;
2. every linked footage/audio file needed to open without missing-media warnings;
3. a list of required fonts (font files only when their license permits sharing);
4. the exact After Effects version used to save it;
5. a list of non-Adobe plugins with vendor, package name, version, and effect match names when known;
6. one reference render or still for each visually important expected state;
7. 3–8 plain-language edit requests, each naming the intended composition/layer when ambiguity is part of the case;
8. confirmation that the material contains no client/confidential/personal data, or that it must remain local-only.

Copy `manifest.example.json`, replace its placeholders, calculate SHA-256 hashes locally, and run the read-only validator after the tool is built:

```bash
node tools/chat-tests/dist/src/cli.js corpus /path/to/project/manifest.json
```

The capture step uses the existing panel probe to produce a raw `initial-probe.json`; the benchmark intake then reduces that into the reviewable `expected-structure.json` shape shown beside this file. The initial fingerprint must identify the exact sanitized starting structure used by a run. Those derivatives must be reviewed before `approvedForCommit` is set. The manifest separates base After Effects from optional/required third-party plugins so a missing plugin becomes a classified skip or compatibility result, not a model failure.
