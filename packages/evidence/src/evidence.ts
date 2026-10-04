import type {
  EvidenceRecord,
  Execution,
  Failure,
  FileChange,
  ModelRun,
  ModelRunRef,
  PermissionLevel,
  Plan,
  Task,
  TestRun,
  ToolCall,
  VerificationResult,
  Verdict,
} from "@attest/shared";
import { newId, nowIso, sha256 } from "@attest/shared";

export interface BuildEvidenceInput {
  task: Task;
  plan: Plan;
  execution: Execution;
  verification: VerificationResult;
  fileChanges: FileChange[];
  toolCalls: ToolCall[];
  testRuns: TestRun[];
  failures: Failure[];
  modelRuns: ModelRun[];
  repairs: { attempt: number; description: string; outcome: "resolved" | "unresolved" }[];
  rollbacks: { checkpointRef: string; ok: boolean; at: string }[];
  interpretation: string;
  interpretationProvenance: EvidenceRecord["interpretationProvenance"];
  acceptanceCoverage?: EvidenceRecord["acceptanceCoverage"];
  uncoveredCriteria?: string[];
  finalDiff: string;
  verdict: Verdict;
  residualRisk: string[];
}

/**
 * Assemble the Evidence record.
 *
 * This is the artifact that answers the only question that matters to a developer
 * reading an agent's output: "why should I believe you?"
 *
 * Every field is derived from something that was observed — an executed command, a
 * recorded tool call, a parsed test count — or is explicitly labelled as a model's
 * interpretation. The verdict is copied from the verification result, never authored here.
 */
export function buildEvidence(input: BuildEvidenceInput): EvidenceRecord {
  const { execution, verification } = input;

  const toolsUsed = summariseTools(input.toolCalls);
  const modelsUsed = uniqueModelRefs(input.modelRuns);

  const record: EvidenceRecord = {
    id: newId("ev"),
    taskId: input.task.id,
    projectId: input.task.projectId,
    executionId: execution.id,
    originalIntent: input.task.intent.text,
    interpretation: input.interpretation,
    interpretationProvenance: input.interpretationProvenance,
    planId: input.plan.id,
    planSummary: input.plan.steps.map((s) => `${s.index + 1}. [${s.kind}] ${s.description}`),
    changes: input.fileChanges,
    commands: input.testRuns.map((t) => ({
      command: t.command,
      exitCode: t.exitCode,
      layer: t.layer,
    })),
    toolsUsed,
    modelsUsed,
    testResults: input.testRuns.map((t) => ({
      layer: t.layer,
      ok: t.ok,
      passed: t.passed,
      failed: t.failed,
      summary:
        t.total !== undefined
          ? `${t.passed ?? 0}/${t.total} passing`
          : t.ok
            ? "exited 0"
            : `exited ${t.exitCode}`,
    })),
    failures: input.failures.map((f) => ({
      classification: f.classification,
      signal: f.signal,
      layer: f.layer,
      rootCause: f.rootCauseHypothesis,
    })),
    repairs: input.repairs,
    rollbacks: input.rollbacks,
    acceptanceCoverage: input.acceptanceCoverage ?? [],
    uncoveredCriteria: input.uncoveredCriteria ?? [],
    finalDiff: input.finalDiff,
    verification,
    verdict: input.verdict,
    verdictReasons: verification.rationale,
    residualRisk: input.residualRisk,
    generatedAt: nowIso(),
    digest: "",
  };

  record.digest = digestEvidence(record);
  return record;
}

function summariseTools(calls: ToolCall[]): EvidenceRecord["toolsUsed"] {
  const map = new Map<string, { count: number; highest: PermissionLevel }>();
  const rank: Record<PermissionLevel, number> = { read: 0, execute: 1, write: 2, dangerous: 3 };
  for (const c of calls) {
    const existing = map.get(c.tool);
    if (existing) {
      existing.count++;
      if (rank[c.permission] > rank[existing.highest]) existing.highest = c.permission;
    } else {
      map.set(c.tool, { count: 1, highest: c.permission });
    }
  }
  return [...map.entries()]
    .map(([tool, v]) => ({ tool, count: v.count, highestPermission: v.highest }))
    .sort((a, b) => b.count - a.count);
}

function uniqueModelRefs(runs: ModelRun[]): ModelRunRef[] {
  const seen = new Map<string, ModelRunRef>();
  for (const r of runs) {
    const key = `${r.model.provider}:${r.model.modelId}`;
    if (!seen.has(key)) seen.set(key, r.model);
  }
  return [...seen.values()];
}

/**
 * Canonical digest over the record's substance.
 * Changing any evidence field changes the digest, which is how `attest verify --evidence`
 * detects a record that has been edited after the fact.
 */
export function digestEvidence(record: EvidenceRecord): string {
  const canonical = JSON.stringify({
    taskId: record.taskId,
    executionId: record.executionId,
    originalIntent: record.originalIntent,
    interpretation: record.interpretation,
    planId: record.planId,
    planSummary: record.planSummary,
    changes: record.changes.map((c) => ({
      path: c.path,
      change: c.change,
      beforeHash: c.beforeHash,
      afterHash: c.afterHash,
    })),
    commands: record.commands,
    toolsUsed: record.toolsUsed,
    modelsUsed: record.modelsUsed,
    testResults: record.testResults,
    failures: record.failures,
    repairs: record.repairs,
    rollbacks: record.rollbacks,
    uncoveredCriteria: record.uncoveredCriteria,
    verdict: record.verdict,
    verdictReasons: record.verdictReasons,
    generatedAt: record.generatedAt,
  });
  return sha256(canonical);
}

export function verifyEvidenceDigest(record: EvidenceRecord): { valid: boolean; expected: string; actual: string } {
  const expected = digestEvidence(record);
  return { valid: expected === record.digest, expected, actual: record.digest };
}
