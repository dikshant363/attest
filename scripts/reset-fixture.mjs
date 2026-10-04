#!/usr/bin/env node
/**
 * Restore `examples/auth-fixture` to its committed state.
 *
 * The demonstration deliberately modifies the fixture, and the end-to-end tests assert
 * against a pristine copy of it. npm runs this automatically before `npm test`, so running
 * the demo and then the tests just works.
 *
 * If the fixture is not under version control (a tarball, a vendored copy), this reports
 * that it could not reset rather than failing the test run — the end-to-end suite has its
 * own pristine-guard that will explain the problem precisely if it matters.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "examples", "auth-fixture");

// Artefacts a run leaves behind that are not tracked and must be removed explicitly.
for (const rel of [".attest", "src/middleware", "tests/auth.test.ts"]) {
  await fs.rm(path.join(FIXTURE, rel), { recursive: true, force: true }).catch(() => {});
}

await new Promise((resolve) => {
  execFile(
    "git",
    ["checkout", "--", "examples/auth-fixture"],
    { cwd: ROOT },
    (err) => {
      if (err) {
        // Not a git checkout, or nothing to restore. The test suite guards for this.
        console.warn("reset-fixture: could not restore from git (not a repository?) — continuing");
      }
      resolve();
    },
  );
});
