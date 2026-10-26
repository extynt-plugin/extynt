// Proves the pairing file is replaced atomically at mode 0600, leaving no temporary file beside it.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { readSessionFile, sessionFilePath, writeSessionFile } from "../src/session.js";

test("the session file is replaced atomically at mode 0600 and leaves no temporary file behind", () => {
  const home = mkdtempSync(join(tmpdir(), "extynt-session-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const directory = dirname(sessionFilePath());
    mkdirSync(directory, { recursive: true });
    writeFileSync(sessionFilePath(), "{\"port\":1,\"token\":\"old\"}", { mode: 0o644 });
    writeSessionFile({ port: 4123, token: "new-token" });
    assert.deepEqual(readSessionFile(), { port: 4123, token: "new-token" });
    assert.equal(statSync(sessionFilePath()).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(directory), ["session.json"]);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});
