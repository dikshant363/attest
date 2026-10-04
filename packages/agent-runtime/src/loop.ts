import path from "node:path";
import type { ModelRouter } from "@attest/model-router";
import type { WorldStore } from "@attest/project-world";
import type { ToolRuntime } from "@attest/tool-runtime";
import { CheckpointManager } from "@attest/tool-runtime";
import type { Baseline, VerificationEngine } from "@attest/verification";
import { computeVerdict } from "@attest/verification";
import { buildEvidence } from "@attest/evidence";
import type {
  EvidenceRecord,
  Execution,
  FailureClass,
  FileChange,
  Failure,
  ModelRun,
  PermissionLevel,
  Task,
  TestRun,
  ToolCall,
  Verdict,
} from "@attest/shared";
import { newId, nowIso, readText, truncate, unifiedDiff, writeJsonAtomic } from "@attest/shared";
import { withTaskSpan } from "@attest/observability";
import { AgentTeam, type EditOutput } from "./agents.ts";
import { renderProjectContext, type ProjectContextInput } from "./prompts.ts";

export type RunEvent =
  | { type: "phase"; phase: string; detail?: string }
  | { type: "log"; message: string }
  | { type: "model"; role: string; modelId: string; provider: string; weightClass: string }
  | { type: "tool"; name: string; ok: boolean; permission: PermissionLevel; mutation: boolean }
  | { type: "file"; change: FileChange }
  | { type: "layer"; layer: string; status: "start" | "done"; ok?: boolean }
  | { type: "failure"; classification: FailureClass; layer: string; signal: string }
  | { type: "checkpoint"; id: string; ref: string; files: number }
  | { type: "rollback"; ok: boolean; restored: number; deleted: number; errors: string[] }
  | { type: "repair"; attempt: number; rootCause: string; editCount: number }
  | { type: "verdict"; verdict: Verdict; reasons: string[] }
  | { type: "done"; task: Task; evidenceId?: string };

export interface RunTaskOptions {
  intent: string;
  maxAttempts?: number;
  dryRun?: boolean;
  allowDangerous?: boolean;
  /** Skip the independent model review pass. */
  skipReview?: boolean;
  /**
   * Deterministic regression replay.
   *
   * Supplying this replaces the implementer's first edit with a recorded change set.
   * It exists so the failure/recovery demonstration is reproducible on any machine,
   * including one with no model installed. The live path (no injection) is the default.
   */
  injectRegression?: { path: string; content?: string; search?: string; replace?: string }[];
  /**
   * Deterministic repair replay, the counterpart to `injectRegression`.
   *
   * When set, the repair step replays a recorded correction instead of asking a model.
   * This makes the recoverability demonstration reproducible. The live model-driven
   * repair remains the default whenever this is not supplied.
   */
  injectRepair?: { path: string; content?: string; search?: string; replace?: string }[];
  timeoutMs?: number;
  onEvent?: (e: RunEvent) => void;
}

export interface RunTaskResult {
  task: Task;
  evidence: EvidenceRecord;
  execution: Execution;
}

/**
 * The autonomous loop.
 *
 * INTENT → INTERPRET → PLAN → BASELINE → CHECKPOINT → EXECUTE → VERIFY
 *        → (on failure) ROLLBACK → DIAGNOSE → REPAIR → VERIFY
 *        → EVIDENCE
 *
 * Invariants enforced here, not by convention:
 *   1. No mutation happens outside a checkpoint.
 *   2. A verdict comes only from computeVerdict(), never from a model.
 *   3. A failed attempt is rolled back before it is repaired.
 *   4. The loop stops on its own after maxAttempts and reports, rather than thrashing.
 *   5. An Evidence record is produced on every terminal path, including failure.
 */
export class AgentLoop {
  private team: AgentTeam;
  private checkpoints: CheckpointManager;
  private modelRuns: ModelRun[] = [];

  constructor(
    private readonly deps: {
      root: string;
      store: WorldStore;
      router: ModelRouter;
      tools: ToolRuntime;
      verification: VerificationEngine;
    },
  ) {
    this.team = new AgentTeam(deps.router);
    this.checkpoints = new CheckpointManager(deps.root);
    // Every model call is recorded in the Project World, including fallbacks.
    deps.router.onRun = (run) => {
      this.modelRuns.push(run);
      this.deps.store.addModelRun(run).catch(() => undefined);
    };
  }

  private emit(opts: RunTaskOptions, e: RunEvent): void {
    opts.onEvent?.(e);
  }

  /**
   * Run one task.
   *
   * The whole loop is wrapped in a single `gen_ai.invoke_agent` span so the trace has one
   * root to open, with `gen_ai.chat` and `gen_ai.execute_tool` spans beneath it. Verdict
   * attributes are attached at the end, because the verdict is the answer the trace exists
   * to explain.
   */
  async run(opts: RunTaskOptions): Promise<RunTaskResult> {
    return withTaskSpan(opts.intent, this.deps.store.project.id, async (addAttributes) => {
      const result = await this.runInner(opts);
      addAttributes({
        "attest.verdict": result.task.verdict ?? "UNKNOWN",
        "attest.task.status": result.task.status,
        "attest.task.attempts": result.task.attempt,
        "attest.evidence.id": result.evidence.id,
        "attest.failures.count": result.evidence.failures.length,
        "attest.repairs.count": result.evidence.repairs.length,
        "attest.rollbacks.count": result.evidence.rollbacks.length,
        "attest.tools.count": result.evidence.toolsUsed.length,
        "attest.models.used": result.evidence.modelsUsed.map((m) => m.modelId).join(", "),
        "attest.residual_risk.count": result.evidence.residualRisk.length,
      });
      return result;
    });
  }

  private async runInner(opts: RunTaskOptions): Promise<RunTaskResult> {
    const { store, tools, verification } = this.deps;
    const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
    const project = store.project;

    // ---- 1. Task ---------------------------------------------------------
    const task = await store.createTask({
      projectId: project.id,
      intent: {
        id: newId("req"),
        text: opts.intent,
        acceptanceCriteria: [],
        provenance: { source: "human", confidence: 1, at: nowIso() },
      },
      status: "planning",
      maxAttempts,
    });
    this.emit(opts, { type: "phase", phase: "interpret", detail: "turn your request into testable criteria" });

    // ---- 2. Interpret ----------------------------------------------------
    const memories = store.retrieve(opts.intent, 6);
    const baseContext: ProjectContextInput = {
      project,
      world: store.data,
      memories: memories.map((m) => m.text),
      decisions: store.data.decisions.map((d) => `${d.title}: ${d.decision}`),
    };

    let interpretation = "";
    let interpretationProvenance = {
      source: "human" as const,
      confidence: 1,
      at: nowIso(),
      note: "interpretation step unavailable",
    };
    let ambiguities: string[] = [];
    const riskNotes: string[] = [];

    try {
      const interp = await this.team.interpret(opts.intent, baseContext);
      interpretation = interp.interpretation;
      interpretationProvenance = interp.provenance as typeof interpretationProvenance;
      ambiguities = interp.ambiguities;
      riskNotes.push(...interp.riskNotes);
      await store.updateTask(task.id, { intent: interp.requirement, status: "planning" });
      this.emit(opts, {
        type: "log",
        message: `understood: ${interpretation.slice(0, 200)}`,
      });
      if (ambiguities.length) {
        this.emit(opts, { type: "log", message: `ambiguities flagged: ${ambiguities.join("; ")}` });
      }
    } catch (err) {
      // Interpretation failure must not abort the task: fall back to the raw intent
      // and record that we did so, rather than pretending we understood.
      const message = err instanceof Error ? err.message : String(err);
      interpretation = `(interpretation step failed: ${message}) Using the request verbatim.`;
      ambiguities = [message];
      this.emit(opts, { type: "log", message: `interpretation failed: ${message}` });
    }
    await store.markMemoriesUsed(memories.map((m) => m.id));

    const freshTask = store.getTask(task.id)!;

    // ---- 3. Plan ---------------------------------------------------------
    this.emit(opts, { type: "phase", phase: "plan", detail: "produce an executable plan" });
    const plan = await this.team.plan(freshTask, baseContext, "medium");
    await store.addPlan(plan);
    await store.updateTask(task.id, { status: "planned" });
    for (const step of plan.steps) {
      this.emit(opts, { type: "log", message: `  ${step.index + 1}. [${step.kind}] ${step.description}` });
    }
    if (plan.risks.length) {
      this.emit(opts, { type: "log", message: `  risks: ${plan.risks.join("; ")}` });
    }

    // ---- 4. Baseline -----------------------------------------------------
    this.emit(opts, { type: "phase", phase: "baseline", detail: "run the project's own tests before touching anything" });
    const baseline = await verification.captureBaseline(opts.timeoutMs ?? 300_000);
    if (baseline.noTestsDeclared) {
      this.emit(opts, {
        type: "log",
        message: "no test command declared — verification cannot execute tests for this project",
      });
    } else if (baseline.green) {
      this.emit(opts, {
        type: "log",
        message: `baseline green: ${baseline.passed ?? "?"} passing${baseline.total ? `/${baseline.total}` : ""}`,
      });
    } else {
      this.emit(opts, {
        type: "log",
        message: `WARNING baseline is already red (${baseline.failed ?? "?"} failing). Regression cannot be proven from here.`,
      });
    }

    // ---- 5. Attempt loop -------------------------------------------------
    const allToolCalls: ToolCall[] = [];
    const allFailures: Failure[] = [];
    const allRollbacks: { checkpointRef: string; ok: boolean; at: string }[] = [];
    const repairs: { attempt: number; description: string; outcome: "resolved" | "unresolved" }[] = [];
    const residualRisk: string[] = [];

    let pendingEdits: EditOutput["edits"] | undefined;
    let lastExecution: Execution | undefined;
    let finalVerdict: Verdict = "UNVERIFIED";
    let finalVerification = undefined as undefined | Awaited<ReturnType<VerificationEngine["run"]>>["verification"];
    let attempt = 1;
    let rollbackHappened = false;

    while (attempt <= maxAttempts) {
      const execution = await store.addExecution({
        id: newId("exec"),
        taskId: task.id,
        attempt,
        planId: plan.id,
        startedAt: nowIso(),
        status: "running",
        toolCallIds: [],
        fileChangeIds: [],
        testRunIds: [],
        failureIds: [],
        modelRunIds: [],
        completedStepIds: [],
      });
      lastExecution = execution;
      await store.updateTask(task.id, { status: "executing", attempt });

      const toolCtx = {
        root: this.deps.root,
        taskId: task.id,
        executionId: execution.id,
        allowWrite: !opts.dryRun,
        allowExecute: true,
        allowDangerous: Boolean(opts.allowDangerous),
        dryRun: Boolean(opts.dryRun),
        timeoutMs: opts.timeoutMs ?? 300_000,
      };

      const hooks = {
        onToolCall: async (call: ToolCall) => {
          allToolCalls.push(call);
          await store.audit({
            action: `tool.${call.tool}`,
            permission: call.permission,
            actor: "runtime",
            taskId: task.id,
            executionId: execution.id,
            detail: call.ok ? "ok" : (call.error ?? "failed"),
          });
          this.emit(opts, {
            type: "tool",
            name: call.tool,
            ok: call.ok,
            permission: call.permission,
            mutation: call.mutating,
          });
        },
      };

      // ---- checkpoint (invariant 1) ------------------------------------
      const { checkpoint } = await this.checkpoints.create({
        taskId: task.id,
        executionId: execution.id,
        reason: `before attempt ${attempt} of "${opts.intent.slice(0, 60)}"`,
      });
      await store.addCheckpoint(checkpoint);
      await store.updateExecution(execution.id, { checkpointId: checkpoint.id });
      const snapshot = await this.checkpoints.load(checkpoint.id);
      this.emit(opts, {
        type: "checkpoint",
        id: checkpoint.id,
        ref: checkpoint.ref,
        files: snapshot?.entries.length ?? 0,
      });

      // ---- execute ------------------------------------------------------
      this.emit(opts, {
        type: "phase",
        phase: attempt === 1 ? "execute" : `execute (repair, attempt ${attempt})`,
      });

      const fileChanges: FileChange[] = [];
      let edits: EditOutput["edits"] = [];
      let editReasoning = "";

      try {
        if (pendingEdits) {
          edits = pendingEdits;
          editReasoning = "repair edit set from previous attempt";
        } else if (opts.injectRegression) {
          // Deterministic replay path for the reproducible recovery demonstration.
          edits = opts.injectRegression;
          editReasoning = "injected regression replay (demo determinism)";
          this.emit(opts, {
            type: "log",
            message: `injected regression: ${edits.length} edit(s) — this is a recorded change set, not model output`,
          });
        } else {
          // Investigation phase: read what we need, through the audited tool runtime.
          const readRequest = await this.team.requestReads(freshTask, plan, baseContext);
          const files: { path: string; content: string }[] = [];
          for (const p of readRequest.files) {
            try {
              const res = await tools.invoke("read_file", { path: p, maxBytes: 60_000 }, toolCtx, hooks);
              const out = res.output as { content: string };
              files.push({ path: p, content: out.content });
            } catch {
              /* an unreadable file is simply not shown to the model */
            }
          }
          this.emit(opts, {
            type: "log",
            message: `read ${files.length} file(s) for context${readRequest.notes ? `: ${readRequest.notes}` : ""}`,
          });

          const editResult = await this.team.edit(
            freshTask,
            plan,
            { ...baseContext, files },
            "medium",
          );
          edits = editResult.output.edits;
          editReasoning = editResult.output.reasoning;
          this.emit(opts, {
            type: "model",
            role: "implementer",
            modelId: editResult.modelId,
            provider: editResult.provider,
            weightClass: editResult.weightClass,
          });
        }

        if (edits.length === 0) {
          throw new Error("the implementer produced no edits; nothing to verify");
        }
        this.emit(opts, { type: "log", message: `approach: ${editReasoning.slice(0, 240)}` });

        const applied = await tools.invoke("apply_edits", { edits }, toolCtx, hooks);
        const results = (applied.output as { results: FileChange[] }).results ?? [];
        fileChanges.push(...results);
        for (const c of fileChanges) this.emit(opts, { type: "file", change: c });
        await store.updateExecution(execution.id, {
          fileChangeIds: fileChanges.map((c) => c.path),
          toolCallIds: allToolCalls.map((c) => c.id),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit(opts, { type: "log", message: `execution failed: ${message}` });
        const failure: Failure = {
          id: newId("fail"),
          executionId: execution.id,
          classification: "unknown",
          signal: message,
          layer: "execute",
          at: nowIso(),
        };
        allFailures.push(failure);
        await store.addFailure(failure);
        if (attempt >= maxAttempts) {
          // Nothing was applied (or a partial batch was rejected atomically), so the
          // safest terminal action is an explicit rollback to prove the workspace state.
          const rollback = await this.rollback(checkpoint.id, task.id, opts);
          allRollbacks.push({ checkpointRef: checkpoint.ref, ok: rollback.ok, at: nowIso() });
          rollbackHappened = true;
          finalVerdict = "BLOCKED";
          await store.updateExecution(execution.id, {
            status: "failed",
            finishedAt: nowIso(),
            failureIds: allFailures.map((f) => f.id),
          });
          break;
        }
        pendingEdits = edits.length ? edits : undefined;
        attempt++;
        continue;
      }

      // ---- verify -------------------------------------------------------
      this.emit(opts, { type: "phase", phase: "verify", detail: "execute the project's own checks" });
      const outcome = await this.deps.verification.run({
        taskId: task.id,
        executionId: execution.id,
        changedPaths: fileChanges.map((c) => c.path),
        baseline,
        timeoutMs: opts.timeoutMs ?? 300_000,
        onLayer: (layer, status, ok) => this.emit(opts, { type: "layer", layer, status, ok }),
      });
      await store.addVerification(outcome.verification);
      finalVerification = outcome.verification;
      this.lastTestRuns = outcome.layers
        .filter((l): l is typeof l & { testRun: TestRun } => Boolean(l.testRun))
        .map((l) => l.testRun);
      await store.updateExecution(execution.id, {
        testRunIds: outcome.layers.filter((l) => l.testRun).map((l) => l.testRun!.id),
      });

      const layerResults = outcome.layers.map((l) => l.result);
      const { verdict } = computeVerdict(outcome.layers);
      finalVerdict = verdict;

      if (verdict === "VERIFIED" || verdict === "PARTIALLY_VERIFIED") {
        // ---- optional independent review --------------------------------
        let reviewConcerns: string[] = [];
        if (!opts.skipReview) {
          try {
            const diffText = fileChanges.map((c) => c.diff ?? "").join("\n");
            const review = await this.team.review({
              task: freshTask,
              diff: diffText,
              context: baseContext,
              authorModelId: edits.length && !opts.injectRegression ? this.modelRuns.at(-1)?.model.modelId ?? "" : "",
              authorProvider: this.modelRuns.at(-1)?.model.provider ?? "",
            });
            reviewConcerns = review.concerns;
            if (review.concerns.length) {
              this.emit(opts, {
                type: "log",
                message: `independent review (${review.modelId}) raised ${review.concerns.length} concern(s)`,
              });
              for (const c of reviewConcerns) this.emit(opts, { type: "log", message: `  concern: ${c}` });
            } else {
              this.emit(opts, { type: "log", message: `independent review (${review.modelId}): no concerns` });
            }
          } catch (err) {
            reviewConcerns = [];
            this.emit(opts, {
              type: "log",
              message: `independent review unavailable: ${err instanceof Error ? err.message : String(err)}`,
            });
            residualRisk.push("Independent model review did not run; only executable checks were applied.");
          }
        }
        residualRisk.push(...reviewConcerns.map((c) => `Reviewer concern: ${c}`));

        await store.updateExecution(execution.id, {
          status: "completed",
          finishedAt: nowIso(),
          verificationId: outcome.verification.id,
          failureIds: allFailures.map((f) => f.id),
        });
        break;
      }

      // ---- failure path -------------------------------------------------
      const failingLayer = locateFailingLayer(layerResults, verdict);
      const classification = classifyFailure(failingLayer.layer, outcome.failureSignal);
      const failure: Failure = {
        id: newId("fail"),
        executionId: execution.id,
        classification,
        signal: outcome.failureSignal || failingLayer.summary,
        layer: failingLayer.layer,
        at: nowIso(),
      };
      allFailures.push(failure);
      await store.addFailure(failure);
      this.emit(opts, {
        type: "failure",
        classification,
        layer: failure.layer,
        signal: outcome.failureSignal || failingLayer.summary,
      });

      await store.updateExecution(execution.id, {
        status: "failed",
        finishedAt: nowIso(),
        failureIds: allFailures.map((f) => f.id),
        verificationId: outcome.verification.id,
      });

      // Invariant 4: stop rather than thrash.
      if (attempt >= maxAttempts) {
        const rollback = await this.rollback(checkpoint.id, task.id, opts);
        allRollbacks.push({ checkpointRef: checkpoint.ref, ok: rollback.ok, at: nowIso() });
        rollbackHappened = true;
        this.emit(opts, {
          type: "log",
          message: `reached max attempts (${maxAttempts}); rolled back to known-good state`,
        });
        break;
      }

      // Invariant 3: roll back BEFORE repairing, so the repair is computed against
      // a known-good workspace rather than on top of a broken one.
      this.emit(opts, { type: "phase", phase: "rollback", detail: "restore the checkpoint before diagnosing" });
      const rollback = await this.rollback(checkpoint.id, task.id, opts);
      allRollbacks.push({ checkpointRef: checkpoint.ref, ok: rollback.ok, at: nowIso() });
      rollbackHappened = true;
      if (!rollback.ok) {
        this.emit(opts, {
          type: "log",
          message: "ROLLBACK FAILED to verify; refusing to continue autonomously",
        });
        repairs.push({ attempt, description: "rollback verification failed", outcome: "unresolved" });
        break;
      }

      // ---- diagnose + repair --------------------------------------------
      this.emit(opts, { type: "phase", phase: "diagnose", detail: "explain the failure from its actual output" });
      const touched = [...new Set(edits.map((e) => e.path))];
      const filesAfterRollback: { path: string; content: string }[] = [];
      for (const p of touched) {
        const abs = path.join(this.deps.root, p);
        const content = await readText(abs);
        if (content !== undefined) filesAfterRollback.push({ path: p, content: truncate(content, 60_000) });
      }

      let repairOutput: Awaited<ReturnType<AgentTeam["repair"]>> | undefined;
      if (opts.injectRepair) {
        // Deterministic replay path. Clearly labelled so no reader mistakes it for
        // model output, and so the evidence record carries the same distinction.
        this.emit(opts, {
          type: "log",
          message: `replaying a recorded repair (${opts.injectRepair.length} edit(s)) — not model output`,
        });
        repairOutput = {
          output: {
            rootCause:
              "The authentication guard was applied to the whole request surface, so it ran before the public /health route and before route matching. Auth must be scoped to the /api/ surface, with the login route evaluated first.",
            reasoning: "Scope the session guard to /api/* and evaluate the login route before it.",
            edits: opts.injectRepair,
          },
          modelId: "recorded-repair",
          provider: "replay",
          weightClass: "open-weight",
        } as unknown as Awaited<ReturnType<AgentTeam["repair"]>>;
      } else {
        try {
          repairOutput = await this.team.repair({
            task: freshTask,
            plan,
            context: { ...baseContext, files: filesAfterRollback },
            failureSignal: outcome.failureSignal || failingLayer.summary,
            failedLayer: failingLayer.layer,
            previousEdits: edits,
          });
        } catch (err) {
          this.emit(opts, {
            type: "log",
            message: `repair attempt failed to produce a change: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (!repairOutput || repairOutput.output.edits.length === 0) {
        repairs.push({
          attempt,
          description: repairOutput?.output.rootCause || "no repair could be produced",
          outcome: "unresolved",
        });
        this.emit(opts, {
          type: "log",
          message: "no viable repair; the task cannot be completed safely with the information available",
        });
        break;
      }

      this.emit(opts, {
        type: "repair",
        attempt,
        rootCause: repairOutput.output.rootCause,
        editCount: repairOutput.output.edits.length,
      });
      this.emit(opts, {
        type: "model",
        role: "repairer",
        modelId: repairOutput.modelId,
        provider: repairOutput.provider,
        weightClass: repairOutput.weightClass,
      });

      // Record the diagnosis as a lesson the project world keeps.
      await store.addMemory({
        kind: "lesson",
        projectId: project.id,
        text: `Task "${opts.intent.slice(0, 80)}": attempt ${attempt} failed in layer "${failingLayer.layer}" (${classification}). Root cause: ${repairOutput.output.rootCause}`,
        provenance: {
          source: "model",
          confidence: 0.6,
          modelId: repairOutput.modelId,
          at: nowIso(),
          note: "hypothesis recorded after an executed failure; not a verified fact",
        },
      });

      pendingEdits = repairOutput.output.edits;
      repairs.push({
        attempt,
        description: repairOutput.output.rootCause || repairOutput.output.reasoning.slice(0, 200),
        outcome: "resolved",
      });
      allToolCalls.length = allToolCalls.length; // keep history intact across attempts
      attempt++;
    }

    // ---- 6. Evidence (invariant 5: every terminal path) -----------------
    const execution = lastExecution!;
    const finalRollback = allRollbacks.at(-1);

    if (rollbackHappened && (finalVerdict === "UNVERIFIED" || finalVerdict === "BLOCKED")) {
      finalVerdict = finalVerdict === "BLOCKED" ? "BLOCKED" : "ROLLED_BACK";
    }

    const finalDiff = await this.computeFinalDiff(execution, allToolCalls);
    const allChanges = await this.collectChanges(execution.id, allToolCalls);

    if (baseline && !baseline.noTestsDeclared && !baseline.green) {
      residualRisk.push(
        `The repository's tests were already failing before this task (${baseline.failed ?? "?"} failing). ` +
          `Pass/fail on this change is therefore not conclusive.`,
      );
    }
    if (baseline?.noTestsDeclared) {
      residualRisk.push(
        "This project declares no test command, so no test layer ran. The verdict is based only on the layers that did run.",
      );
    }
    if (finalVerdict === "ROLLED_BACK") {
      residualRisk.push(
        "The change was rolled back. The workspace is at the pre-task state; no part of this task was applied.",
      );
    }
    if (finalVerdict === "BLOCKED") {
      residualRisk.push("The task could not be completed. Manual intervention is required.");
    }
    if (ambiguities.length) {
      residualRisk.push(`The request was ambiguous: ${ambiguities.join("; ")}`);
    }
    for (const r of riskNotes) residualRisk.push(`Planner risk note: ${r}`);

    const verificationResult =
      finalVerification ??
      ({
        id: newId("ver"),
        taskId: task.id,
        executionId: execution.id,
        layers: [],
        skipped: ["verification never ran"],
        startedAt: nowIso(),
        finishedAt: nowIso(),
        verdict: finalVerdict,
        rationale: ["verification did not execute"],
      } as unknown as NonNullable<typeof finalVerification>);

    const evidence = buildEvidence({
      task: freshTask,
      plan,
      execution,
      verification: verificationResult,
      fileChanges: allChanges,
      toolCalls: allToolCalls,
      testRuns: this.lastTestRuns,
      failures: allFailures,
      modelRuns: this.modelRuns,
      repairs,
      rollbacks: allRollbacks,
      interpretation,
      interpretationProvenance: interpretationProvenance as never,
      finalDiff,
      verdict: finalVerdict,
      residualRisk: [...new Set(residualRisk)],
    });
    await store.addEvidence(evidence);

    const finalStatus =
      finalVerdict === "VERIFIED" || finalVerdict === "PARTIALLY_VERIFIED"
        ? finalVerdict === "VERIFIED"
          ? "verified"
          : "unverified"
        : finalVerdict === "ROLLED_BACK"
          ? "rolled_back"
          : finalVerdict === "BLOCKED"
            ? "blocked"
            : "unverified";

    const updatedTask = await store.updateTask(task.id, {
      status: finalStatus,
      verdict: finalVerdict,
      evidenceId: evidence.id,
      executionIds: execution ? [execution.id] : [],
    });

    this.emit(opts, { type: "verdict", verdict: finalVerdict, reasons: verificationResult.rationale });
    this.emit(opts, { type: "done", task: updatedTask, evidenceId: evidence.id });

    if (this.deps.root) {
      await writeJsonAtomic(
        path.join(this.deps.root, ".attest", "runs", `${execution.id}.json`),
        {
          taskId: task.id,
          intent: opts.intent,
          plan,
          toolCalls: allToolCalls,
          failures: allFailures,
          repairs,
          rollbacks: allRollbacks,
          verdict: finalVerdict,
          residualRisk,
        },
      ).catch(() => undefined);
    }

    return { task: updatedTask, evidence, execution };
  }

  /** Collected during verification so evidence can cite real test counts. */
  private lastTestRuns: TestRun[] = [];

  private async rollback(
    checkpointId: string,
    taskId: string,
    opts: RunTaskOptions,
  ): Promise<{ ok: boolean; restored: number; deleted: number; errors: string[] }> {
    const report = await this.checkpoints.restore(checkpointId);
    await this.deps.store.markCheckpointRestored(checkpointId, report.ok);
    await this.deps.store.audit({
      action: "task.rollback",
      permission: "write",
      actor: "runtime",
      taskId,
      detail: `restored=${report.restored.length} deleted=${report.deleted.length} ok=${report.ok}`,
    });
    this.emit(opts, {
      type: "rollback",
      ok: report.ok,
      restored: report.restored.length,
      deleted: report.deleted.length,
      errors: report.errors,
    });
    return {
      ok: report.ok,
      restored: report.restored.length,
      deleted: report.deleted.length,
      errors: report.errors,
    };
  }

  private async collectChanges(executionId: string, toolCalls: ToolCall[]): Promise<FileChange[]> {
    // Rebuild from the persisted execution record so the evidence covers every attempt.
    const exec = this.deps.store.getExecution(executionId);
    if (!exec) return [];
    const changes: FileChange[] = [];
    for (const runId of exec.fileChangeIds) {
      // fileChangeIds hold paths in this implementation; dedupe by path keeping the last.
      const existingIndex = changes.findIndex((c) => c.path === runId);
      const abs = path.join(this.deps.root, runId);
      const content = await readText(abs);
      const change: FileChange = {
        path: runId,
        change: content === undefined ? "delete" : "modify",
        diff: undefined,
        added: content ? content.split("\n").length : 0,
        removed: 0,
      };
      if (existingIndex >= 0) changes[existingIndex] = change;
      else changes.push(change);
    }
    return changes;
  }

  private async computeFinalDiff(execution: Execution, toolCalls: ToolCall[]): Promise<string> {
    const exec = this.deps.store.getExecution(execution.id);
    const checkpoint = exec?.checkpointId ? this.deps.store.getCheckpoint(exec.checkpointId) : undefined;
    const snapshot = checkpoint ? await this.checkpoints.load(checkpoint.id) : undefined;
    const parts: string[] = [];

    const paths = [...new Set(exec?.fileChangeIds ?? [])];
    for (const rel of paths) {
      const abs = path.join(this.deps.root, rel);
      const current = await readText(abs);
      const before = snapshot?.entries.find((e) => e.path === rel)?.content;
      if (before === undefined && current === undefined) continue;
      if (before === current) continue;
      if (before === undefined) {
        parts.push(unifiedDiff("", current ?? "", { path: rel }));
      } else if (current === undefined) {
        parts.push(unifiedDiff(before, "", { path: rel }));
      } else {
        parts.push(unifiedDiff(before, current, { path: rel }));
      }
    }
    void toolCalls;
    return parts.filter(Boolean).join("\n");
  }
}

export function classifyFailure(layer: string, signal: string): FailureClass {
  if (/timed out|timeout/i.test(signal)) return "timeout";
  switch (layer) {
    case "typecheck":
      return "type_error";
    case "lint":
      return "lint_error";
    case "build":
      return "build_error";
    case "security":
      return "security";
    case "unit":
    case "integration":
    case "e2e":
    case "regression":
      return "test_assertion";
    default:
      return "unknown";
  }
}

function locateFailingLayer(
  layers: { layer: string; ok: boolean; ran: boolean; summary: string }[],
  verdict: Verdict,
): { layer: string; summary: string } {
  const failing = layers.find((l) => l.ran && !l.ok);
  if (failing) return { layer: failing.layer, summary: failing.summary };
  const skipped = layers.find((l) => !l.ran);
  if (skipped) return { layer: skipped.layer, summary: skipped.summary };
  return { layer: "unknown", summary: `verdict ${verdict} with no failing layer identified` };
}
