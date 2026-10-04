#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Runs the TypeScript sources directly through tsx so the checked-in code is exactly
 * the code that executes — no build step between what a reviewer reads and what runs.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.join(here, "..", "packages", "cli", "src", "main.ts");

const child = spawn(process.execPath, ["--import", "tsx", main, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
