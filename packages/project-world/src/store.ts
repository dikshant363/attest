import fs from "node:fs/promises";
import path from "node:path";
import type {
  AuditEntry,
  Checkpoint,
  EvidenceRecord,
  Execution,
  Failure,
  MemoryEntry,
  ModelRun,
  PermissionLevel,
  Plan,
  Project,
  ProjectWorld,
  Task,
  VerificationResult,
} from "@attest/shared";
import { ensureDir, newId, nowIso, readJson, writeJsonAtomic } from "@attest/shared";

export const ATTEST_DIR = ".attest";

export function attestDir(root: string): string {
  return path.join(root, ATTEST_DIR);
}

export function emptyWorld(project: Project): ProjectWorld {
  return {
    project,
    tasks: [],
    plans: [],
    executions: [],
    evidence: [],
    checkpoints: [],
    failures: [],
    verifications: [],
    decisions: project.decisions,
    memories: [],
    modelRuns: [],
  };
}

/**
 * The persistent Project World.
 *
 * Storage choice: a single JSON document plus an append-only audit log, written
 * atomically. No database, no daemon, no native module. For a single-developer
 * local tool this is strictly better than Postgres: it is inspectable with `cat`,
 * diffable in git, requires zero setup, and cannot fail to connect.
 * If the world outgrows a single document, the store interface is the seam to
 * swap in SQLite/pgvector without touching runtime code.
 */
export class WorldStore {
  private world: ProjectWorld;
  private auditSeq = 0;
  private auditBuffer: AuditEntry[] = [];

  private constructor(
    readonly root: string,
    world: ProjectWorld,
  ) {
    this.world = world;
  }

  static async open(root: string): Promise<WorldStore> {
    const file = path.join(attestDir(root), "world.json");
    const existing = await readJson<ProjectWorld>(file);
    if (!existing) {
      throw new Error(
        `no Project World found at ${path.relative(process.cwd(), file)}. Run: attest init`,
      );
    }
    const store = new WorldStore(root, existing);
    await store.loadAuditSeq();
    return store;
  }

  static async exists(root: string): Promise<boolean> {
    return (await readJson(path.join(attestDir(root), "world.json"))) !== undefined;
  }

  static async create(root: string, project: Project): Promise<WorldStore> {
    await ensureDir(attestDir(root));
    const store = new WorldStore(root, emptyWorld(project));
    await store.save();
    await store.audit({ action: "world.create", permission: "write", actor: "runtime" });
    return store;
  }

  get data(): ProjectWorld {
    return this.world;
  }

  get project(): Project {
    return this.world.project;
  }

  private async loadAuditSeq(): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(attestDir(this.root), "audit.jsonl"), "utf8");
      this.auditSeq = raw.split("\n").filter((l) => l.trim()).length;
    } catch {
      this.auditSeq = 0;
    }
  }

  async save(): Promise<void> {
    this.world.project.updatedAt = nowIso();
    await writeJsonAtomic(path.join(attestDir(this.root), "world.json"), this.world);
  }

  /** Append-only audit. Every mutating action goes through here. */
  async audit(entry: Omit<AuditEntry, "seq" | "at">): Promise<void> {
    const full: AuditEntry = { seq: ++this.auditSeq, at: nowIso(), ...entry };
    await ensureDir(attestDir(this.root));
    await fs.appendFile(
      path.join(attestDir(this.root), "audit.jsonl"),
      JSON.stringify(full) + "\n",
      "utf8",
    );
  }

  async readAudit(limit = 200): Promise<AuditEntry[]> {
    try {
      const raw = await fs.readFile(path.join(attestDir(this.root), "audit.jsonl"), "utf8");
      return raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as AuditEntry)
        .slice(-limit);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  async createTask(
    task: Omit<Task, "id" | "createdAt" | "updatedAt" | "attempt" | "executionIds" | "maxAttempts"> & {
      maxAttempts?: number;
    },
  ): Promise<Task> {
    const { maxAttempts, ...rest } = task;
    const full: Task = {
      id: newId("task"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      attempt: 0,
      executionIds: [],
      maxAttempts: maxAttempts ?? 2,
      ...rest,
    } as Task;
    this.world.tasks.push(full);
    await this.audit({
      action: "task.create",
      permission: "write",
      actor: "runtime",
      taskId: full.id,
      detail: full.intent.text.slice(0, 200),
    });
    await this.save();
    return full;
  }

  getTask(id: string): Task | undefined {
    return this.world.tasks.find((t) => t.id === id);
  }

  latestTask(): Task | undefined {
    return this.world.tasks[this.world.tasks.length - 1];
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const task = this.getTask(id);
    if (!task) throw new Error(`unknown task ${id}`);
    Object.assign(task, patch, { updatedAt: nowIso() });
    await this.save();
    return task;
  }

  /** Record a human override. Autonomy without an interrupt path is not acceptable. */
  async recordHumanOverride(
    taskId: string,
    action: "pause" | "resume" | "cancel" | "approve" | "reject",
    note?: string,
  ): Promise<void> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`unknown task ${taskId}`);
    task.humanOverride = { action, at: nowIso(), note };
    if (action === "cancel") task.status = "cancelled";
    await this.audit({ action: `human.${action}`, permission: "write", actor: "human", taskId, detail: note });
    await this.save();
  }

  // -------------------------------------------------------------------------
  // Plans / executions
  // -------------------------------------------------------------------------

  async addPlan(plan: Plan): Promise<Plan> {
    this.world.plans.push(plan);
    await this.audit({
      action: "plan.create",
      permission: "write",
      actor: "model",
      taskId: plan.taskId,
      detail: `${plan.steps.length} steps via ${plan.producedBy.provider}:${plan.producedBy.modelId}`,
    });
    await this.save();
    return plan;
  }

  getPlan(id: string): Plan | undefined {
    return this.world.plans.find((p) => p.id === id);
  }

  async addExecution(exec: Execution): Promise<Execution> {
    this.world.executions.push(exec);
    await this.audit({
      action: "execution.start",
      permission: "execute",
      actor: "runtime",
      taskId: exec.taskId,
      executionId: exec.id,
      detail: `attempt ${exec.attempt}`,
    });
    await this.save();
    return exec;
  }

  getExecution(id: string): Execution | undefined {
    return this.world.executions.find((e) => e.id === id);
  }

  async updateExecution(id: string, patch: Partial<Execution>): Promise<Execution> {
    const exec = this.getExecution(id);
    if (!exec) throw new Error(`unknown execution ${id}`);
    Object.assign(exec, patch);
    await this.save();
    return exec;
  }

  // -------------------------------------------------------------------------
  // Checkpoints
  // -------------------------------------------------------------------------

  async addCheckpoint(cp: Checkpoint): Promise<Checkpoint> {
    this.world.checkpoints.push(cp);
    await this.audit({
      action: "checkpoint.create",
      permission: "write",
      actor: "runtime",
      taskId: cp.taskId,
      executionId: cp.executionId,
      detail: `${cp.kind} ${cp.ref}`,
    });
    await this.save();
    return cp;
  }

  getCheckpoint(id: string): Checkpoint | undefined {
    return this.world.checkpoints.find((c) => c.id === id);
  }

  async markCheckpointRestored(id: string, ok: boolean): Promise<void> {
    const cp = this.getCheckpoint(id);
    if (!cp) return;
    cp.restoredAt = nowIso();
    cp.restoredOk = ok;
    await this.audit({
      action: "checkpoint.restore",
      permission: "write",
      actor: "runtime",
      taskId: cp.taskId,
      detail: `${cp.ref} ok=${ok}`,
    });
    await this.save();
  }

  // -------------------------------------------------------------------------
  // Failures / verification / evidence
  // -------------------------------------------------------------------------

  async addFailure(f: Failure): Promise<Failure> {
    this.world.failures.push(f);
    await this.audit({
      action: "failure.detected",
      permission: "read",
      actor: "runtime",
      executionId: f.executionId,
      detail: `${f.classification} in ${f.layer}`,
    });
    await this.save();
    return f;
  }

  async addVerification(v: VerificationResult): Promise<VerificationResult> {
    this.world.verifications.push(v);
    await this.audit({
      action: "verification.complete",
      permission: "read",
      actor: "runtime",
      taskId: v.taskId,
      executionId: v.executionId,
      detail: `verdict=${v.verdict}`,
    });
    await this.save();
    return v;
  }

  async addEvidence(record: EvidenceRecord): Promise<EvidenceRecord> {
    this.world.evidence.push(record);
    const dir = path.join(attestDir(this.root), "evidence");
    await ensureDir(dir);
    await writeJsonAtomic(path.join(dir, `${record.id}.json`), record);
    await this.audit({
      action: "evidence.seal",
      permission: "write",
      actor: "runtime",
      taskId: record.taskId,
      detail: `${record.verdict} digest=${record.digest}`,
    });
    await this.save();
    return record;
  }

  getEvidence(id: string): EvidenceRecord | undefined {
    return this.world.evidence.find((e) => e.id === id);
  }

  // -------------------------------------------------------------------------
  // Model runs
  // -------------------------------------------------------------------------

  async addModelRun(run: ModelRun): Promise<void> {
    const enriched = { ...run };
    this.world.modelRuns.push(enriched);
    // Model runs are high-volume; persist opportunistically rather than on every call.
    if (this.world.modelRuns.length % 5 === 0) await this.save();
  }

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  async addMemory(entry: Omit<MemoryEntry, "id" | "createdAt" | "usedCount">): Promise<MemoryEntry> {
    const full: MemoryEntry = { id: newId("mem"), createdAt: nowIso(), usedCount: 0, ...entry };
    this.world.memories.push(full);
    await this.save();
    return full;
  }

  /**
   * Keyword-scored retrieval. A vector index is deliberately not used at this size:
   * it would add a dependency and a failure mode for no measurable gain. The seam
   * exists (`retrieve`) so a semantic retriever can replace it later.
   */
  retrieve(query: string, limit = 6): MemoryEntry[] {
    const terms = tokenize(query);
    if (terms.length === 0) return this.world.memories.slice(-limit);
    const scored = this.world.memories.map((m) => {
      const text = tokenize(m.text);
      const set = new Set(text);
      let overlap = 0;
      for (const t of terms) if (set.has(t)) overlap++;
      // Recency and past usefulness are tie-breakers, not primary signals.
      const ageDays = (Date.now() - Date.parse(m.createdAt)) / 86_400_000;
      const recency = 1 / (1 + ageDays / 30);
      return { m, score: overlap * 2 + recency + Math.min(m.usedCount, 5) * 0.1 };
    });
    return scored
      .filter((s) => s.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.m);
  }

  async markMemoriesUsed(ids: string[]): Promise<void> {
    for (const id of ids) {
      const m = this.world.memories.find((x) => x.id === id);
      if (m) m.usedCount++;
    }
    await this.save();
  }

  // -------------------------------------------------------------------------
  // Convenience views for the CLI and web UI
  // -------------------------------------------------------------------------

  summary(): {
    tasks: number;
    verified: number;
    rolledBack: number;
    failures: number;
    evidence: number;
    openTasks: number;
  } {
    const tasks = this.world.tasks;
    return {
      tasks: tasks.length,
      verified: tasks.filter((t) => t.verdict === "VERIFIED").length,
      rolledBack: tasks.filter((t) => t.status === "rolled_back").length,
      failures: this.world.failures.length,
      evidence: this.world.evidence.length,
      openTasks: tasks.filter((t) => !["verified", "unverified", "rolled_back", "cancelled"].includes(t.status))
        .length,
    };
  }

  async runLog(executionId: string, payload: unknown): Promise<void> {
    const dir = path.join(attestDir(this.root), "runs");
    await ensureDir(dir);
    await writeJsonAtomic(path.join(dir, `${executionId}.json`), payload);
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2);
}
