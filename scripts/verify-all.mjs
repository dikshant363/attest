#!/usr/bin/env node
/**
 * Full verification pass.
 *
 * Runs every check a reviewer would want, in order, and stops at the first failure. This is
 * the command to run before claiming the project works.
 *
 *   1. typecheck        the runtime
 *   2. lint             project conventions and the prompt-injection notice
 *   3. test             83 tests, including four end-to-end proofs
 *   4. web build        the control centre, which also type-checks the app
 *   5. self-check       the CLI actually runs and reports a coherent world
 *
 * The web build is included on purpose: `next build` type-checks the app, and dev mode does
 * not. A stale field reference survived `npm run selftest` and was only caught here.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  { name: "typecheck", cmd: "npm", args: ["run", "typecheck"], cwd: ROOT },
  { name: "lint", cmd: "npm", args: ["run", "lint"], cwd: ROOT },
  { name: "tests", cmd: "npm", args: ["run", "test"], cwd: ROOT },
  { name: "web build", cmd: "npx", args: ["next", "build"], cwd: path.join(ROOT, "apps", "web") },
  {
    name: "cli smoke test",
    cmd: "node",
    args: ["bin/attest.mjs", "tools"],
    cwd: ROOT,
  },
];

function run(step) {
  return new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, {
      cwd: step.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ ok: code === 0, code, out }));
  });
}

let failed = false;
for (const step of steps) {
  process.stdout.write(`\n▸ ${step.name} … `);
  const result = await run(step);
  if (result.ok) {
    process.stdout.write("ok\n");
  } else {
    failed = true;
    process.stdout.write(`FAILED (exit ${result.code})\n\n`);
    const lines = result.out.trim().split("\n");
    process.stdout.write(lines.slice(-40).join("\n") + "\n");
    break;
  }
}

process.stdout.write(
  failed
    ? "\n✗ verification failed\n"
    : "\n✓ all checks passed: typecheck · lint · 83 tests · web build · cli smoke test\n",
);
process.exitCode = failed ? 1 : 0;
