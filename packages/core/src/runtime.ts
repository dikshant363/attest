import path from "node:path";
import type { ModelRouter } from "@attest/model-router";
import { createDefaultRouter } from "@attest/model-router";
import { analyzeRepository, WorldStore, attestDir } from "@attest/project-world";
import { CheckpointManager, ToolRuntime } from "@attest/tool-runtime";
import { VerificationEngine } from "@attest/verification";
import { renderEvidenceMarkdown, renderEvidenceSummary, verifyEvidenceDigest } from "@attest/evidence";
import type { EvidenceRecord, ProjectWorld, Task } from "@attest/shared";
import { nowIso, pathExists } from "@attest/shared";
import { AgentLoop, type RunEvent, type RunTaskOptions } from "@attest/agent-runtime";

export interface RuntimeOptions {
  root: string;
  router?: ModelRouter;
}

/**
 * The core runtime facade.
 *
 * Everything above this (CLI, web, future MCP server) is an adapter. This class is the
 * product: it owns the Project World, the tool surface, verification and the agent loop.
 */
export class AttestRuntime {
  readonly root: string;
  readonly router: ModelRouter;

  private constructor(opts: RuntimeOptions) {
    this.root = path.resolve(opts.root);
    this.router = opts.router ?? createDefaultRouter();
  }

  static for(opts: RuntimeOptions): AttestRuntime {
    return new AttestRuntime(opts);
  }

  /** Create a new Project World for this repository. */
  async init(force = false): Promise<{ store: WorldStore; skippedDirs: string[] }> {
    const already = await WorldStore.exists(this.root);
    if (already && !force) {
      throw new Error(
        `a Project World already exists at ${attestDir(this.root)}. Use --force to re-analyze it.`,
      );
    }
    const { project, skippedDirs } = await analyzeRepository(this.root);
    const store = await WorldStore.create(this.root, project);
    await store.audit({
      action: "world.init",
      permission: "write",
      actor: "runtime",
      detail: `${project.stack.languages.join(",")} | ${project.commands.length} command(s) | ${project.testFiles.length} test file(s)`,
    });
    return { store, skippedDirs };
  }

  async open(): Promise<WorldStore> {
    return WorldStore.open(this.root);
  }

  async exists(): Promise<boolean> {
    return WorldStore.exists(this.root);
  }

  /**
   * Re-analyze the repository and merge the fresh observations into the existing world.
   * Human-declared constraints and recorded decisions are preserved: the analyzer must
   * never silently discard knowledge a person put there.
   */
  async analyze(): Promise<{ store: WorldStore; changes: string[] }> {
    const store = await this.open();
    const before = store.project;
    const { project } = await analyzeRepository(this.root);

    const humanConstraints = before.constraints.filter((c) => c.origin === "human");
    const merged = {
      ...project,
      id: before.id,
      createdAt: before.createdAt,
      worldRevision: before.worldRevision + 1,
      constraints: [...project.constraints, ...humanConstraints.filter((h) => !project.constraints.some((c) => c.statement === h.statement))],
      decisions: before.decisions,
    };

    const changes: string[] = [];
    if (before.repository.headSha !== project.repository.headSha) {
      changes.push(`HEAD moved: ${before.repository.headSha ?? "?"} → ${project.repository.headSha ?? "?"}`);
    }
    const addedTests = project.testFiles.filter((t) => !before.testFiles.includes(t));
    if (addedTests.length) changes.push(`${addedTests.length} new test file(s) discovered`);
    const newCommands = project.commands.filter((c) => !before.commands.some((b) => b.command === c.command));
    if (newCommands.length) changes.push(`${newCommands.length} new command(s) discovered`);

    const world: ProjectWorld = store.data;
    world.project = merged;
    await store.save();
    await store.audit({
      action: "world.analyze",
      permission: "read",
      actor: "runtime",
      detail: `revision ${merged.worldRevision}; ${changes.join("; ") || "no structural change"}`,
    });
    return { store, changes };
  }

  /** Execute one engineering task end to end. */
  async runTask(intent: string, opts: Partial<RunTaskOptions> = {}): Promise<{
    task: Task;
    evidence: EvidenceRecord;
    store: WorldStore;
  }> {
    const store = await this.open();
    const tools = ToolRuntime.withDefaults(this.root);
    const verification = new VerificationEngine(this.root, store.project);
    const loop = new AgentLoop({
      root: this.root,
      store,
      router: this.router,
      tools,
      verification,
    });
    const result = await loop.run({ intent, ...opts });
    return { task: result.task, evidence: result.evidence, store };
  }

  /** Run tools/verification with a caller-supplied event sink, for programmatic use and tests. */
  async runTaskWithEvents(
    intent: string,
    opts: Partial<RunTaskOptions> & { onEvent?: (e: RunEvent) => void },
  ): Promise<{ task: Task; evidence: EvidenceRecord }> {
    const { task, evidence } = await this.runTask(intent, opts);
    return { task, evidence };
  }

  async evidence(id: string): Promise<EvidenceRecord | undefined> {
    const store = await this.open();
    return store.getEvidence(id);
  }

  /** Render an evidence record, optionally as markdown for a report. */
  async renderEvidence(id: string, opts: { markdown?: boolean; includeDiff?: boolean } = {}): Promise<string> {
    const store = await this.open();
    const record = store.getEvidence(id);
    if (!record) throw new Error(`no evidence record ${id}`);
    if (opts.markdown === false) return renderEvidenceSummary(record);
    return opts.markdown
      ? renderEvidenceMarkdown(record, { includeDiff: opts.includeDiff })
      : renderEvidenceSummary(record);
  }

  /** Recompute the seal to detect an edited record. */
  async verifyEvidence(id: string): Promise<{ valid: boolean; expected: string; actual: string; record?: EvidenceRecord }> {
    const store = await this.open();
    const record = store.getEvidence(id);
    if (!record) throw new Error(`no evidence record ${id}`);
    return { ...verifyEvidenceDigest(record), record };
  }

  /** Roll the workspace back to a specific checkpoint. Manual override path. */
  async rollbackCheckpoint(checkpointId: string): Promise<{
    ok: boolean;
    restored: number;
    deleted: number;
    errors: string[];
  }> {
    const store = await this.open();
    const manager = new CheckpointManager(this.root);
    const report = await manager.restore(checkpointId);
    await store.markCheckpointRestored(checkpointId, report.ok);
    await store.audit({
      action: "human.rollback",
      permission: "write",
      actor: "human",
      detail: `checkpoint=${checkpointId} ok=${report.ok}`,
    });
    return {
      ok: report.ok,
      restored: report.restored.length,
      deleted: report.deleted.length,
      errors: report.errors,
    };
  }

  /** Roll back the most recent checkpoint for a task. */
  async rollbackTask(taskId: string): Promise<{ ok: boolean; restored: number; deleted: number; errors: string[] }> {
    const store = await this.open();
    const checkpoint = [...store.data.checkpoints].reverse().find((c) => c.taskId === taskId);
    if (!checkpoint) throw new Error(`no checkpoint recorded for task ${taskId}`);
    const report = await this.rollbackCheckpoint(checkpoint.id);
    await store.recordHumanOverride(taskId, "reject", `rolled back to ${checkpoint.ref}`);
    return report;
  }

  async listCheckpoints(): Promise<{ id: string; createdAt: string; bytes: number; files: number }[]> {
    return new CheckpointManager(this.root).list();
  }

  async status(): Promise<{
    project: ProjectWorld["project"];
    summary: ReturnType<WorldStore["summary"]>;
    tasks: Task[];
    lastEvidence?: EvidenceRecord;
    checkpointCount: number;
    auditTail: Awaited<ReturnType<WorldStore["readAudit"]>>;
  }> {
    const store = await this.open();
    const data = store.data;
    const checkpoints = await this.listCheckpoints();
    return {
      project: data.project,
      summary: store.summary(),
      tasks: data.tasks,
      lastEvidence: data.evidence.at(-1),
      checkpointCount: checkpoints.length,
      auditTail: await store.readAudit(12),
    };
  }

  /** Write a human-readable evidence report next to the sealed JSON. */
  async exportEvidenceReport(id: string, outPath?: string): Promise<string> {
    const store = await this.open();
    const record = store.getEvidence(id);
    if (!record) throw new Error(`no evidence record ${id}`);
    const target = outPath ?? path.join(attestDir(this.root), "evidence", `${id}.md`);
    const markdown = renderEvidenceMarkdown(record, { includeDiff: true });
    const fs = await import("node:fs/promises");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, markdown, "utf8");
    await store.audit({ action: "evidence.export", permission: "read", actor: "human", detail: target });
    return target;
  }

  /** Record an architectural decision so the Project World remembers why. */
  async recordDecision(input: {
    title: string;
    context: string;
    decision: string;
    alternatives?: string[];
    consequences?: string[];
  }): Promise<void> {
    const store = await this.open();
    const entry = {
      id: `adr_${Date.now().toString(36)}`,
      title: input.title,
      context: input.context,
      decision: input.decision,
      alternatives: input.alternatives ?? [],
      consequences: input.consequences ?? [],
      provenance: { source: "human" as const, confidence: 1, at: nowIso() },
    };
    store.data.project.decisions.push(entry);
    store.data.decisions.push(entry);
    await store.save();
    await store.audit({
      action: "decision.record",
      permission: "write",
      actor: "human",
      detail: entry.title,
    });
  }

  /** True when both a world and a repository are usable. */
  async ready(): Promise<{ ready: boolean; problems: string[] }> {
    const problems: string[] = [];
    if (!(await this.exists())) problems.push("no Project World; run: attest init");
    if (!(await pathExists(this.root))) problems.push(`project root does not exist: ${this.root}`);
    return { ready: problems.length === 0, problems };
  }
}

export { AttestRuntime as Core };
export type { RunEvent, RunTaskOptions };
