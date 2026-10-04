#!/usr/bin/env node
/**
 * Project lint.
 *
 * This is a deliberately small, dependency-free check that enforces the conventions this
 * codebase actually relies on. It is not a general-purpose linter and does not pretend to
 * be one: every rule here exists because breaking it caused, or would cause, a real bug.
 *
 * Rules
 *   no-require        ESM sources must not use require() — it fails at runtime in ESM.
 *   explicit-ts-ext   Relative imports must carry the .ts extension, or Node cannot resolve them.
 *   no-console        Library code must not write to stdout; output belongs to the CLI.
 *   no-process-exit   Only the CLI entry point may terminate the process.
 *   workflow-context  Prompts fed to a model must mark untrusted content as data.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IGNORE = new Set(["node_modules", ".git", ".attest", "dist", ".next", "coverage"]);

/** @type {{file:string,line:number,rule:string,message:string}[]} */
const problems = [];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(ts|mts)$/.test(entry.name)) await check(full);
    else if (entry.name.endsWith(".mjs")) await check(full, true);
  }
}

async function check(file, isScript = false) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (rel.startsWith("examples/")) return; // the fixture is sample data, not our source
  const source = await fs.readFile(file, "utf8");
  const lines = source.split("\n");
  const isCli = rel.includes("packages/cli/") || rel.startsWith("scripts/") || isScript;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (!isCli && /\brequire\s*\(/.test(line) && !/\/\//.test(line.slice(0, line.indexOf("require")))) {
      problems.push({ file: rel, line: lineNo, rule: "no-require", message: "use ESM import instead of require()" });
    }
    if (/\bprocess\.exit\s*\(/.test(line) && !rel.includes("cli/") && !isScript) {
      problems.push({
        file: rel,
        line: lineNo,
        rule: "no-process-exit",
        message: "library code must throw; only the CLI entry point may exit",
      });
    }
    if (!isCli && /\bconsole\.(log|info)\s*\(/.test(line)) {
      problems.push({
        file: rel,
        line: lineNo,
        rule: "no-console",
        message: "library code must not print; return data or emit an event",
      });
    }
    // Relative imports must be explicit about the .ts extension.
    const importMatch = line.match(/from\s+"(\.\.?\/[^"]+)"/);
    if (importMatch && !/\.(ts|json|mjs|js)$/.test(importMatch[1])) {
      problems.push({
        file: rel,
        line: lineNo,
        rule: "explicit-ts-ext",
        message: `relative import "${importMatch[1]}" must end in .ts`,
      });
    }
  }
}

await walk(ROOT);

// Prompt-safety check: every prompt builder that embeds repository content must be
// accompanied by an instruction treating that content as data. This is a real injection
// control, so it is checked rather than trusted.
const prompts = path.join(ROOT, "packages/agent-runtime/src/prompts.ts");
try {
  const src = await fs.readFile(prompts, "utf8");
  if (!/untrusted/i.test(src)) {
    problems.push({
      file: "packages/agent-runtime/src/prompts.ts",
      line: 1,
      rule: "workflow-context",
      message: "prompt builders must state that repository content is untrusted data",
    });
  }
} catch {
  /* file may not exist in a partial checkout */
}

if (problems.length === 0) {
  console.log("lint: clean");
  process.exitCode = 0;
} else {
  for (const p of problems) {
    console.error(`${p.file}:${p.line}  ${p.rule}  ${p.message}`);
  }
  console.error(`\nlint: ${problems.length} problem(s)`);
  process.exitCode = 1;
}
