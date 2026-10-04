import path from "node:path";
import process from "node:process";
import pc from "picocolors";
import { AttestRuntime } from "@attest/core";
import { createDefaultRouter } from "@attest/model-router";
import { ToolRuntime } from "@attest/tool-runtime";
import { renderEvidenceMarkdown, renderEvidenceSummary } from "@attest/evidence";
import type { RunEvent } from "@attest/agent-runtime";
import { flagBool, flagNumber, flagString, parseArgs, validateFlags } from "./args.ts";
import { DEMO_REGRESSION, DEMO_REPAIR, DEMO_TASK } from "./demo-scenario.ts";

const VERSION = "0.1.0";

const USAGE = `
${pc.bold("attest")} — autonomous engineering runtime with evidence-backed verdicts

${pc.bold("USAGE")}
  attest <command> [options]

${pc.bold("CORE")}
  ${pc.cyan("init")}                      Analyse a repository and create its Project World
  ${pc.cyan("analyze")}                   Re-analyse and merge new observations into the world
  ${pc.cyan("task")} <intent>             Run one engineering task end to end
  ${pc.cyan("status")}                    Project World health, tasks, latest verdict
  ${pc.cyan("tasks")}                     List tasks with their verdicts
  ${pc.cyan("demo")}                      Run the scripted failure→rollback→repair demonstration

${pc.bold("TRUST")}
  ${pc.cyan("evidence")} [id]             Human-readable evidence record (--markdown, --diff, --export)
  ${pc.cyan("verify")} [--evidence id]    Re-check an evidence seal; or list verification results
  ${pc.cyan("explain")}                   Plain-language account of the most recent task
  ${pc.cyan("rollback")} --task <id>      Restore the pre-task state (human override)
  ${pc.cyan("checkpoints")}               List reversible checkpoints

${pc.bold("CONFIGURATION")}
  ${pc.cyan("models")} [--probe]          Which models the router can see, and why it picks one
  ${pc.cyan("tools")}                     The tool surface and its permission levels
  ${pc.cyan("audit")}                     Recent entries from the append-only audit log
  ${pc.cyan("decision")} <title>          Record an architecture decision in the world

${pc.bold("COMMON OPTIONS")}
  --dir <path>              Project root (default: current directory)
  --max-attempts <n>        Repair cycles before giving up (default 2)
  --dry-run                 Compute and plan, but do not write
  --yes-dangerous           Allow destructive tools for this run only
  --no-review               Skip the independent model review pass
  --offline                 Refuse any non-local model
  --json                    Machine-readable output

${pc.bold("ENVIRONMENT")}
  ATTEST_OLLAMA_MODEL       Local model tag (default gemma4:e2b)
  ATTEST_OFFLINE=1          Local models only; no network egress
  ATTEST_ALLOW_PROPRIETARY=1  Opt in to non-open-weight models (off by default)
`;

function rootOf(flags: Record<string, string | boolean>): string {
  return path.resolve(flagString(flags, "dir") ?? process.cwd());
}

async function main(): Promise<number> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));

  if (command === "help" || flagBool(flags, "help") || flagBool(flags, "h")) {
    console.log(USAGE);
    return 0;
  }
  if (command === "version") {
    console.log(VERSION);
    return 0;
  }

  const unknown = validateFlags(command, flags);
  if (unknown.length) {
    for (const u of unknown) console.error(pc.red(`error: ${u}`));
    console.error(pc.dim(`run "attest help" for usage`));
    return 2;
  }

  if (flagBool(flags, "offline")) process.env.ATTEST_OFFLINE = "1";
  if (flagBool(flags, "json")) process.env.ATTEST_QUIET = "1";

  const root = rootOf(flags);
  const json = flagBool(flags, "json");
  const runtime = AttestRuntime.for({ root });

  switch (command) {
    case "init":
      return cmdInit(runtime, root, flags, json);
    case "analyze":
      return cmdAnalyze(runtime, json);
    case "task":
      return cmdTask(runtime, positionals, flags, json);
    case "status":
      return cmdStatus(runtime, json);
    case "tasks":
      return cmdTasks(runtime, json);
    case "evidence":
      return cmdEvidence(runtime, positionals, flags, json);
    case "verify":
      return cmdVerify(runtime, flags, json);
    case "explain":
      return cmdExplain(runtime, json);
    case "rollback":
      return cmdRollback(runtime, flags, json);
    case "checkpoints":
      return cmdCheckpoints(runtime, json);
    case "models":
      return cmdModels(runtime, flags, json);
    case "tools":
      return cmdTools(runtime, root, json);
    case "audit":
      return cmdAudit(runtime, flags, json);
    case "decision":
      return cmdDecision(runtime, positionals, flags, json);
    case "demo":
      return cmdDemo(runtime, flags, json);
    default:
      console.error(pc.red(`error: unknown command "${command}"`));
      console.log(USAGE);
      return 2;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInit(
  runtime: AttestRuntime,
  root: string,
  flags: Record<string, string | boolean>,
  json: boolean,
): Promise<number> {
  const { store, skippedDirs } = await runtime.init(flagBool(flags, "force"));
  const p = store.project;
  if (json) {
    console.log(JSON.stringify({ project: p, skippedDirs }, null, 2));
    return 0;
  }
  console.log(`${pc.green("✓")} Project World created at ${pc.dim(path.join(root, ".attest"))}`);
  console.log();
  console.log(`  ${pc.bold("project")}      ${p.name}`);
  console.log(`  ${pc.bold("root")}         ${p.root}`);
  console.log(`  ${pc.bold("languages")}    ${p.stack.languages.join(", ")}`);
  console.log(`  ${pc.bold("frameworks")}   ${p.stack.frameworks.join(", ") || pc.dim("none detected")}`);
  console.log(`  ${pc.bold("git")}          ${p.repository.isGitRepo ? `${p.repository.branch} @ ${p.repository.headSha ?? "?"}` : pc.yellow("not a repository")}`);
  console.log(`  ${pc.bold("test files")}   ${p.testFiles.length}`);
  console.log();
  if (p.commands.length) {
    console.log(`  ${pc.bold("commands (what verification will run)")}`);
    for (const c of p.commands) console.log(`    ${pc.cyan(c.kind.padEnd(10))} ${c.command}`);
  } else {
    console.log(`  ${pc.yellow("No runnable commands discovered — verification cannot execute tests.")}`);
  }
  if (p.constraints.length) {
    console.log();
    console.log(`  ${pc.bold("constraints")}`);
    for (const c of p.constraints) console.log(`    [${c.severity}] ${c.statement}`);
  }
  if (p.unknowns.length) {
    console.log();
    console.log(`  ${pc.bold("what Attest does not know")}`);
    for (const u of p.unknowns) console.log(`    ${pc.dim("—")} ${u}`);
  }
  console.log();
  console.log(pc.dim(`  ${skippedDirs.length} ignorable director(ies) skipped. Next: attest task "<intent>"`));
  return 0;
}

async function cmdAnalyze(runtime: AttestRuntime, json: boolean): Promise<number> {
  const { store, changes } = await runtime.analyze();
  if (json) {
    console.log(JSON.stringify({ revision: store.project.worldRevision, changes }, null, 2));
    return 0;
  }
  console.log(`${pc.green("✓")} world re-analysed at revision ${store.project.worldRevision}`);
  for (const c of changes) console.log(`  ${pc.cyan("•")} ${c}`);
  if (!changes.length) console.log(pc.dim("  no structural change detected"));
  return 0;
}

function makeEventPrinter(): (e: RunEvent) => void {
  const t0 = Date.now();
  const stamp = () => pc.dim(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  return (e: RunEvent) => {
    switch (e.type) {
      case "phase":
        console.log(`\n${stamp()} ${pc.bold(pc.magenta("▸"))} ${pc.bold(e.phase.toUpperCase())}${e.detail ? pc.dim(`  ${e.detail}`) : ""}`);
        break;
      case "log":
        console.log(`${stamp()}   ${e.message}`);
        break;
      case "model":
        console.log(
          `${stamp()}   ${pc.blue("model")} ${e.modelId} ${pc.dim(`(${e.provider}, ${e.weightClass})`)} as ${e.role}`,
        );
        break;
      case "tool":
        console.log(
          `${stamp()}   ${pc.blue("tool")}  ${e.name} ${e.ok ? pc.green("ok") : pc.red("failed")} ${pc.dim(`[${e.permission}]`)}`,
        );
        break;
      case "file":
        console.log(
          `${stamp()}   ${pc.yellow("edit")}  ${e.change.path} ${pc.dim(`(${e.change.change}, +${e.change.added ?? "?"}/-${e.change.removed ?? "?"})`)}`,
        );
        break;
      case "layer":
        if (e.status === "start") console.log(`${stamp()}   ${pc.dim(`running ${e.layer}…`)}`);
        else
          console.log(
            `${stamp()}   ${e.ok ? pc.green("pass") : pc.red("FAIL")}  ${e.layer}`,
          );
        break;
      case "checkpoint":
        console.log(`${stamp()}   ${pc.cyan("◆")} checkpoint ${e.id} ${pc.dim(`(${e.files} files captured)`)}`);
        break;
      case "rollback":
        console.log(
          `${stamp()}   ${e.ok ? pc.cyan("↩") : pc.red("✗")} rollback ${e.ok ? "verified" : "FAILED"} ` +
            pc.dim(`(${e.restored} restored, ${e.deleted} removed)`),
        );
        for (const err of e.errors) console.log(`${stamp()}     ${pc.red(err)}`);
        break;
      case "failure": {
        console.log(`${stamp()}   ${pc.red(pc.bold("✗ FAILURE"))} ${e.classification} in ${e.layer}`);
        const lines = e.signal.split("\n").slice(0, 12);
        for (const l of lines) console.log(`${stamp()}     ${pc.red("|")} ${l.slice(0, 160)}`);
        break;
      }
      case "repair":
        console.log(`${stamp()}   ${pc.green("⚒")} repair attempt ${e.attempt}: ${e.rootCause.slice(0, 200)}`);
        console.log(`${stamp()}     ${pc.dim(`${e.editCount} edit(s)`)}`);
        break;
      case "verdict": {
        const label =
          e.verdict === "VERIFIED"
            ? pc.green(pc.bold(e.verdict))
            : e.verdict === "PARTIALLY_VERIFIED"
              ? pc.yellow(pc.bold(e.verdict))
              : pc.red(pc.bold(e.verdict));
        console.log(`\n${stamp()} ${pc.bold("VERDICT")} ${label}`);
        for (const r of e.reasons) console.log(`${stamp()}   ${r.startsWith("✓") ? pc.green(r) : r.startsWith("✗") ? pc.red(r) : r.startsWith("⚠") ? pc.yellow(r) : pc.dim(r)}`);
        break;
      }
      case "done":
        break;
    }
  };
}

async function cmdTask(
  runtime: AttestRuntime,
  positionals: string[],
  flags: Record<string, string | boolean>,
  json: boolean,
): Promise<number> {
  const intent = positionals.join(" ").trim();
  if (!intent) {
    console.error(pc.red("error: provide an engineering task, e.g. attest task \"add GitHub authentication\""));
    return 2;
  }
  const ready = await runtime.ready();
  if (!ready.ready) {
    for (const p of ready.problems) console.error(pc.red(`error: ${p}`));
    return 1;
  }

  const inject = flagBool(flags, "inject-regression");
  const result = await runtime.runTask(intent, {
    maxAttempts: flagNumber(flags, "max-attempts", 2),
    dryRun: flagBool(flags, "dry-run"),
    allowDangerous: flagBool(flags, "yes-dangerous"),
    skipReview: flagBool(flags, "no-review"),
    timeoutMs: flagNumber(flags, "timeout", 300_000),
    onEvent: json ? undefined : makeEventPrinter(),
    ...(inject ? { injectRegression: DEMO_REGRESSION } : {}),
  });

  if (json) {
    console.log(JSON.stringify({ task: result.task, evidence: result.evidence }, null, 2));
  } else {
    console.log();
    console.log(pc.bold("── Evidence ─────────────────────────────────────────────"));
    console.log(renderEvidenceSummary(result.evidence));
    console.log();
    console.log(pc.dim(`Full record: attest evidence ${result.evidence.id} --markdown`));
  }

  return result.task.verdict === "VERIFIED"
    ? 0
    : result.task.verdict === "PARTIALLY_VERIFIED"
      ? 0
      : 1;
}

async function cmdStatus(runtime: AttestRuntime, json: boolean): Promise<number> {
  const s = await runtime.status();
  if (json) {
    console.log(JSON.stringify(s, null, 2));
    return 0;
  }
  console.log(pc.bold(`${s.project.name}`) + pc.dim(`  ${s.project.root}`));
  console.log(pc.dim(`world revision ${s.project.worldRevision} · ${s.project.stack.languages.join(", ")}`));
  console.log();
  console.log(`  tasks           ${s.summary.tasks}  ${pc.dim(`(${s.summary.openTasks} open)`)}`);
  console.log(`  verified        ${pc.green(String(s.summary.verified))}`);
  console.log(`  rolled back     ${s.summary.rolledBack > 0 ? pc.cyan(String(s.summary.rolledBack)) : "0"}`);
  console.log(`  failures seen   ${s.summary.failures}`);
  console.log(`  evidence sealed ${s.summary.evidence}`);
  console.log(`  checkpoints     ${s.checkpointCount}`);
  if (s.project.commands.length) {
    console.log();
    console.log(pc.bold("  verification commands"));
    for (const c of s.project.commands) console.log(`    ${c.kind.padEnd(10)} ${pc.dim(c.command)}`);
  }
  if (s.tasks.length) {
    console.log();
    console.log(pc.bold("  recent tasks"));
    for (const t of s.tasks.slice(-5)) {
      const v = t.verdict ?? "—";
      const colored =
        v === "VERIFIED" ? pc.green(v) : v === "PARTIALLY_VERIFIED" ? pc.yellow(v) : v === "—" ? pc.dim(v) : pc.red(v);
      console.log(`    ${t.id}  ${colored.padEnd(28)} ${t.intent.text.slice(0, 60)}`);
    }
  }
  return 0;
}

async function cmdTasks(runtime: AttestRuntime, json: boolean): Promise<number> {
  const store = await runtime.open();
  const tasks = store.data.tasks;
  if (json) {
    console.log(JSON.stringify(tasks, null, 2));
    return 0;
  }
  if (!tasks.length) {
    console.log(pc.dim("no tasks yet. Run: attest task \"<intent>\""));
    return 0;
  }
  for (const t of tasks) {
    console.log(
      `${t.id}  ${(t.verdict ?? t.status).padEnd(20)} attempt ${t.attempt}  ${t.intent.text.slice(0, 70)}`,
    );
  }
  return 0;
}

async function cmdEvidence(
  runtime: AttestRuntime,
  positionals: string[],
  flags: Record<string, string | boolean>,
  json: boolean,
): Promise<number> {
  const store = await runtime.open();
  const id = positionals[0] ?? store.data.evidence.at(-1)?.id;
  if (!id) {
    console.error(pc.red("error: no evidence record exists yet"));
    return 1;
  }
  const record = store.getEvidence(id);
  if (!record) {
    console.error(pc.red(`error: no evidence record "${id}"`));
    return 1;
  }
  if (flagBool(flags, "export")) {
    const target = await runtime.exportEvidenceReport(id, flagString(flags, "export") || undefined);
    console.log(`${pc.green("✓")} exported to ${target}`);
    return 0;
  }
  if (json) {
    console.log(JSON.stringify(record, null, 2));
    return 0;
  }
  if (flagBool(flags, "markdown")) {
    console.log(renderEvidenceMarkdown(record, { includeDiff: flagBool(flags, "diff") }));
  } else {
    console.log(renderEvidenceSummary(record));
    console.log();
    console.log(pc.dim(`add --markdown for the full human-readable report`));
  }
  return 0;
}

async function cmdVerify(runtime: AttestRuntime, flags: Record<string, string | boolean>, json: boolean): Promise<number> {
  const store = await runtime.open();
  const id = flagString(flags, "evidence") ?? store.data.evidence.at(-1)?.id;
  if (!id) {
    console.error(pc.red("error: no evidence record to verify"));
    return 1;
  }
  const result = await runtime.verifyEvidence(id);
  if (json) {
    console.log(JSON.stringify({ id, ...result, record: undefined }, null, 2));
    return result.valid ? 0 : 1;
  }
  console.log(`${pc.bold("evidence")} ${id}`);
  console.log(`  verdict        ${result.record?.verdict}`);
  console.log(`  sealed digest  ${result.actual}`);
  console.log(`  recomputed     ${result.expected}`);
  console.log(
    result.valid
      ? `  ${pc.green("✓ seal intact — the record has not been modified since it was produced")}`
      : `  ${pc.red("✗ SEAL BROKEN — this record was modified after it was produced")}`,
  );
  return result.valid ? 0 : 1;
}

async function cmdExplain(runtime: AttestRuntime, json: boolean): Promise<number> {
  const store = await runtime.open();
  const record = store.data.evidence.at(-1);
  const task = store.data.tasks.at(-1);
  if (!record || !task) {
    console.error(pc.red("error: nothing has been run yet"));
    return 1;
  }
  if (json) {
    console.log(JSON.stringify({ task, evidence: record }, null, 2));
    return 0;
  }
  console.log(pc.bold(`What happened when you asked: `) + `"${record.originalIntent}"`);
  console.log();
  console.log(`${pc.bold("1. Understood as")}  ${record.interpretation}`);
  console.log();
  console.log(`${pc.bold("2. Plan")}`);
  for (const s of record.planSummary) console.log(`   ${s}`);
  console.log();
  console.log(`${pc.bold("3. Files changed")}  ${record.changes.length}`);
  for (const c of record.changes) console.log(`   ${c.change}  ${c.path}`);
  console.log();
  console.log(`${pc.bold("4. Executed")}`);
  for (const c of record.commands) console.log(`   [${c.exitCode === 0 ? "ok" : "fail"}] (${c.layer}) ${c.command}`);
  console.log();
  console.log(`${pc.bold("5. Verification")}`);
  for (const l of record.verification.layers) {
    console.log(`   ${(!l.ran ? pc.dim("skipped") : l.ok ? pc.green("pass") : pc.red("FAIL")).padEnd(20)} ${l.layer.padEnd(12)} ${pc.dim(l.summary)}`);
  }
  if (record.failures.length) {
    console.log();
    console.log(`${pc.bold("6. What went wrong")}`);
    for (const f of record.failures) {
      console.log(`   ${pc.red(f.classification)} in ${f.layer}`);
      if (f.rootCause) console.log(`     diagnosis: ${f.rootCause}`);
    }
  }
  if (record.rollbacks.length) {
    console.log();
    console.log(`${pc.bold("7. Rollbacks")}`);
    for (const r of record.rollbacks) console.log(`   ${r.checkpointRef} → ${r.ok ? "restored and verified" : "FAILED"}`);
  }
  if (record.repairs.length) {
    console.log();
    console.log(`${pc.bold("8. Repairs")}`);
    for (const r of record.repairs) console.log(`   attempt ${r.attempt}: ${r.description} → ${r.outcome}`);
  }
  console.log();
  console.log(`${pc.bold("9. Models used")}`);
  for (const m of record.modelsUsed) console.log(`   ${m.modelId} ${pc.dim(`(${m.provider}, ${m.weightClass})`)}`);
  console.log();
  const v = record.verdict;
  console.log(
    `${pc.bold("10. Verdict")} ` +
      (v === "VERIFIED" ? pc.green(v) : v === "PARTIALLY_VERIFIED" ? pc.yellow(v) : pc.red(v)),
  );
  for (const r of record.verdictReasons) console.log(`   ${r}`);
  if (record.residualRisk.length) {
    console.log();
    console.log(pc.bold("11. What you should still check"));
    for (const r of record.residualRisk) console.log(`   ${pc.yellow("⚠")} ${r}`);
  }
  return 0;
}

async function cmdRollback(runtime: AttestRuntime, flags: Record<string, string | boolean>, json: boolean): Promise<number> {
  const taskId = flagString(flags, "task");
  const checkpointId = flagString(flags, "checkpoint");
  if (!taskId && !checkpointId) {
    console.error(pc.red("error: provide --task <id> or --checkpoint <id>"));
    return 2;
  }
  const report = checkpointId
    ? await runtime.rollbackCheckpoint(checkpointId)
    : await runtime.rollbackTask(taskId!);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }
  console.log(
    `${report.ok ? pc.green("✓") : pc.red("✗")} rollback ${report.ok ? "verified" : "FAILED"}: ` +
      `${report.restored} file(s) restored, ${report.deleted} removed`,
  );
  for (const e of report.errors) console.error(pc.red(`  ${e}`));
  return report.ok ? 0 : 1;
}

async function cmdCheckpoints(runtime: AttestRuntime, json: boolean): Promise<number> {
  const list = await runtime.listCheckpoints();
  if (json) {
    console.log(JSON.stringify(list, null, 2));
    return 0;
  }
  if (!list.length) {
    console.log(pc.dim("no checkpoints yet"));
    return 0;
  }
  for (const c of list) {
    console.log(`${c.id}  ${c.createdAt}  ${String(c.files).padStart(4)} files  ${(c.bytes / 1024).toFixed(0)} KB`);
  }
  return 0;
}

async function cmdModels(runtime: AttestRuntime, flags: Record<string, string | boolean>, json: boolean): Promise<number> {
  const router = runtime.router ?? createDefaultRouter();
  await router.refresh();
  const models = await (async () => {
    const all: Awaited<ReturnType<typeof router.selectCandidates>> = [];
    for (const provider of router.getProviders()) {
      for (const m of await provider.listModels()) all.push(m);
    }
    return all;
  })();

  if (flagBool(flags, "probe")) {
    console.log(pc.dim("probing models (latency + JSON compliance)…"));
    const results = await router.probe();
    if (json) {
      console.log(JSON.stringify(results, null, 2));
      return 0;
    }
    for (const r of results) {
      console.log(
        `${r.modelId.padEnd(28)} ${r.reachable ? pc.green("reachable") : pc.red("unreachable")} ` +
          `${r.latencyMs ? `${r.latencyMs}ms` : ""} ${r.jsonCompliant !== undefined ? `json=${r.jsonCompliant}` : ""} ${r.error ?? ""}`,
      );
    }
    return 0;
  }

  if (flagBool(flags, "why")) {
    console.log(await router.explain({ role: "repairer", system: "", prompt: "", difficulty: "high" }));
    return 0;
  }

  const cfg = router.config;
  console.log(pc.bold("Policy"));
  console.log(`  open-weight only    ${cfg.allowProprietary ? pc.yellow("NO — proprietary permitted") : pc.green("YES")}`);
  console.log(`  offline only        ${cfg.offlineOnly ? pc.green("YES") : "no"}`);
  console.log(`  hosted gateway      ${cfg.allowGateway ? "enabled" : pc.dim("disabled")}`);
  console.log(`  local model         ${cfg.ollamaModel}`);
  console.log(`  gateway model       ${cfg.gatewayModel}`);
  console.log();
  console.log(pc.bold("Models visible to the router"));
  if (!models.length) {
    console.log(pc.yellow("  none. Start a local model with: ollama serve"));
  }
  for (const m of models) {
    const verdict = router.isAllowed(m);
    const tag = verdict.allowed ? pc.green("allowed") : pc.dim(`refused (${verdict.reason})`);
    console.log(
      `  ${m.provider}:${m.id.padEnd(24)} ${m.weightClass.padEnd(14)} code=${m.capabilities.codeStrength} cost=${m.costTier}  ${tag}`,
    );
  }
  return 0;
}

async function cmdTools(_runtime: AttestRuntime, root: string, json: boolean): Promise<number> {
  const tools = ToolRuntime.withDefaults(root).list();
  if (json) {
    console.log(JSON.stringify(tools, null, 2));
    return 0;
  }
  console.log(pc.bold("Tool surface") + pc.dim(`  digest ${ToolRuntime.withDefaults(root).surfaceDigest()}`));
  console.log();
  for (const t of tools) {
    const color =
      t.permission === "dangerous"
        ? pc.red
        : t.permission === "write"
          ? pc.yellow
          : t.permission === "execute"
            ? pc.cyan
            : pc.dim;
    console.log(`  ${t.name.padEnd(14)} ${color(`[${t.permission}]`).padEnd(24)} ${pc.dim(t.description.slice(0, 80))}`);
  }
  console.log();
  console.log(pc.dim("  Destructive tools are refused unless a run passes --yes-dangerous."));
  return 0;
}

async function cmdAudit(runtime: AttestRuntime, flags: Record<string, string | boolean>, json: boolean): Promise<number> {
  const store = await runtime.open();
  const entries = await store.readAudit(flagNumber(flags, "limit", 40));
  if (json) {
    console.log(JSON.stringify(entries, null, 2));
    return 0;
  }
  for (const e of entries) {
    console.log(
      `${String(e.seq).padStart(4)}  ${e.at}  ${e.actor.padEnd(8)} ${e.permission.padEnd(9)} ${e.action.padEnd(24)} ${pc.dim((e.detail ?? "").slice(0, 70))}`,
    );
  }
  return 0;
}

async function cmdDecision(
  runtime: AttestRuntime,
  positionals: string[],
  flags: Record<string, string | boolean>,
  json: boolean,
): Promise<number> {
  const title = positionals.join(" ").trim();
  if (!title) {
    console.error(pc.red("error: provide a decision title"));
    return 2;
  }
  await runtime.recordDecision({
    title,
    context: flagString(flags, "context") ?? "",
    decision: flagString(flags, "decision") ?? title,
    alternatives: (flagString(flags, "alternatives") ?? "").split("|").filter(Boolean),
    consequences: (flagString(flags, "consequences") ?? "").split("|").filter(Boolean),
  });
  if (json) console.log(JSON.stringify({ recorded: title }));
  else console.log(`${pc.green("✓")} decision recorded: ${title}`);
  return 0;
}

/**
 * The scripted demonstration.
 *
 * Runs the real runtime against a real repository with a real test suite. The first edit
 * and the repair replay recorded change sets so the recovery path is reproducible;
 * detection, rollback, verification and evidence are the genuine runtime.
 * See `demo-scenario.ts` for the full disclosure of what is and is not scripted.
 */
async function cmdDemo(runtime: AttestRuntime, flags: Record<string, string | boolean>, json: boolean): Promise<number> {
  const readiness = await runtime.ready();
  if (!readiness.ready) {
    console.error(pc.red("error: no Project World here. Run: attest init"));
    return 1;
  }
  console.log(pc.bold(pc.magenta("\n══ Attest demonstration: a change that fails, and recovers ══\n")));
  console.log(
    pc.dim(
      "The first edit and the repair replay recorded change sets (see docs/DEMO.md).\n" +
        "Detection, checkpointing, rollback, re-verification and the evidence record are real.\n",
    ),
  );

  const result = await runtime.runTask(DEMO_TASK, {
    maxAttempts: 2,
    skipReview: flagBool(flags, "no-review"),
    allowDangerous: flagBool(flags, "yes-dangerous"),
    onEvent: json ? undefined : makeEventPrinter(),
    injectRegression: DEMO_REGRESSION,
    injectRepair: DEMO_REPAIR,
  });

  if (json) {
    console.log(JSON.stringify({ task: result.task, evidence: result.evidence }, null, 2));
    return 0;
  }

  console.log();
  console.log(pc.bold("── Outcome ──────────────────────────────────────────────"));
  console.log(renderEvidenceSummary(result.evidence));
  console.log();
  console.log(pc.dim(`Full record:  attest evidence ${result.evidence.id} --markdown --diff`));
  console.log(pc.dim(`Report file:  attest evidence ${result.evidence.id} --export`));
  return result.task.verdict === "VERIFIED" ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(pc.red(`\nerror: ${err instanceof Error ? err.message : String(err)}`));
    if (process.env.ATTEST_DEBUG === "1" && err instanceof Error) console.error(err.stack);
    process.exitCode = 1;
  });
