#!/usr/bin/env node
/**
 * Bake a real Project World into `apps/web/data/` for the hosted control centre.
 *
 * The hosted instance has no developer machine to analyse, so the deployment serves a
 * snapshot. The important word is *snapshot*, not *mock*: this copies the world and audit
 * log that the actual runtime wrote while running the demonstration against
 * `examples/auth-fixture`. Every verdict, failure, rollback and model id in the hosted UI
 * came from a real run.
 *
 * Usage:
 *   node scripts/bake-demo-world.mjs [--project examples/auth-fixture]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const projectFlagIndex = args.indexOf("--project");
const PROJECT_DIR = path.resolve(
  ROOT,
  projectFlagIndex !== -1 ? args[projectFlagIndex + 1] : "examples/auth-fixture",
);

const source = path.join(PROJECT_DIR, ".attest");
const target = path.join(ROOT, "apps", "web", "data");

async function main() {
  let world;
  try {
    world = JSON.parse(await fs.readFile(path.join(source, "world.json"), "utf8"));
  } catch {
    console.error(
      `No Project World at ${path.relative(ROOT, source)}.\n` +
        `Run the demonstration first:\n` +
        `  node bin/attest.mjs init --dir ${path.relative(ROOT, PROJECT_DIR)}\n` +
        `  node bin/attest.mjs demo --dir ${path.relative(ROOT, PROJECT_DIR)}`,
    );
    process.exitCode = 1;
    return;
  }

  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "world.json"), JSON.stringify(world, null, 2), "utf8");

  // The audit log is what makes the hosted UI's audit page real rather than decorative.
  try {
    const audit = await fs.readFile(path.join(source, "audit.jsonl"), "utf8");
    await fs.writeFile(path.join(target, "audit.jsonl"), audit, "utf8");
  } catch {
    console.warn("no audit log found; the audit page will be empty on the hosted instance");
  }

  const latest = world.evidence?.at(-1);
  console.log(`baked world → ${path.relative(ROOT, path.join(target, "world.json"))}`);
  console.log(`  project    ${world.project?.name}`);
  console.log(`  tasks      ${world.tasks?.length ?? 0}`);
  console.log(`  evidence   ${world.evidence?.length ?? 0}`);
  console.log(`  models     ${[...new Set((world.modelRuns ?? []).map((r) => r.model.modelId))].join(", ") || "—"}`);
  if (latest) {
    console.log(`  last       ${latest.verdict} (${latest.id})`);
    console.log(`             failures=${latest.failures.length} rollbacks=${latest.rollbacks.length} repairs=${latest.repairs.length}`);
  }
}

await main();
