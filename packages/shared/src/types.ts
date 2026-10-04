/**
 * @attest/shared — the domain vocabulary of the Project World.
 *
 * Design rule: everything an agent would otherwise have to re-derive is a first-class,
 * persisted entity here. Nothing in this file imports a model or a network client.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type Id = string;

/** Provenance for any claim, so model guesses are never confused with verified facts. */
export interface Provenance {
  /** How this knowledge entered the world. */
  source: "observed" | "model" | "human" | "executed" | "derived";
  confidence: number; // 0..1
  /** For model-sourced claims: which model, and when. */
  modelId?: string;
  at: string; // ISO-8601
  /** Free-form note, e.g. the command that produced an observation. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Project World entities
// ---------------------------------------------------------------------------

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "ruby"
  | "php"
  | "csharp"
  | "other";

export interface StackInfo {
  languages: Language[];
  /** e.g. "next", "react", "express", "fastapi" */
  frameworks: string[];
  packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "pip" | "poetry" | "cargo" | "go" | "unknown";
  /** Raw dependency names -> version specifier, from the primary manifest. */
  dependencies: Record<string, string>;
  /** Relative paths of the manifests that were actually read. */
  manifests: string[];
}

/** A command the Project World believes is meaningful, discovered from the repo, not invented. */
export interface ProjectCommand {
  /** Stable key: "test" | "typecheck" | "lint" | "build" | custom */
  kind: string;
  command: string;
  /** Which file declared it (package.json script, Makefile target, ...). */
  declaredIn: string;
  /** Whether we have executed it successfully at least once. */
  lastExitCode?: number;
  lastRunAt?: string;
}

export interface RepositoryInfo {
  root: string;
  /** Whether the root is inside a git work tree. */
  isGitRepo: boolean;
  branch?: string;
  /** Short sha of HEAD at analysis time. */
  headSha?: string;
  /** Whether the working tree had uncommitted changes at analysis time. */
  dirty?: boolean;
  remoteUrl?: string;
}

/** A constraint the runtime must not violate. Some are discovered, some are declared by a human. */
export interface Constraint {
  id: Id;
  /** Short imperative statement, e.g. "GET /health must remain unauthenticated". */
  statement: string;
  /** How we know. */
  origin: "discovered" | "human" | "model";
  /** Which file/test encodes the constraint, when applicable. */
  enforcedBy?: string;
  severity: "hard" | "soft";
  provenance: Provenance;
}

export interface ArchitectureDecision {
  id: Id;
  title: string;
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string[];
  provenance: Provenance;
}

export type TaskStatus =
  | "created"
  | "planning"
  | "planned"
  | "executing"
  | "evaluating"
  | "repairing"
  | "blocked"
  | "verified"
  | "unverified"
  | "rolled_back"
  | "cancelled";

/** The strongest claim we are willing to make about a task. Computed, never generated. */
export type Verdict =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "UNVERIFIED"
  | "ROLLED_BACK"
  | "BLOCKED";

export interface Requirement {
  id: Id;
  /** The developer's own words. */
  text: string;
  /** Testable restatements. */
  acceptanceCriteria: string[];
  provenance: Provenance;
}

export interface Task {
  id: Id;
  projectId: Id;
  intent: Requirement;
  status: TaskStatus;
  verdict?: Verdict;
  createdAt: string;
  updatedAt: string;
  /** Attempt number, incremented by each repair cycle. */
  attempt: number;
  maxAttempts: number;
  /** Ids of executions, in order. */
  executionIds: Id[];
  /** Id of the Evidence record produced for this task. */
  evidenceId?: Id;
  /** Free-form reason when status is blocked/cancelled. */
  blockedReason?: string;
  /** Set when a human pauses/cancels. */
  humanOverride?: { action: "pause" | "resume" | "cancel" | "approve" | "reject"; at: string; note?: string };
}

export type PlanStepKind =
  | "investigate"
  | "edit"
  | "create"
  | "delete"
  | "run_command"
  | "verify";

export interface PlanStep {
  id: Id;
  index: number;
  kind: PlanStepKind;
  /** What this step accomplishes, in the developer's domain language. */
  description: string;
  /** Files this step expects to touch, best-effort. */
  targets: string[];
  /** For run_command: the exact command. */
  command?: string;
  /** Whether completing this step is required before the task can be verified. */
  required: boolean;
}

export interface Plan {
  id: Id;
  taskId: Id;
  steps: PlanStep[];
  /** Risks the planner identified, surfaced to the developer. */
  risks: string[];
  /** How the planner proposes to verify completion. */
  verificationStrategy: string[];
  /** Which model produced this plan. */
  producedBy: ModelRunRef;
  createdAt: string;
  /** Human edits to a plan are recorded, not silently merged. */
  humanEdits?: string;
}

export interface ModelRunRef {
  modelId: string;
  provider: string;
  /** "open-weight" vs "proprietary" — the runtime must be able to prove its open-source core. */
  weightClass: "open-weight" | "proprietary" | "unknown";
}

export interface ModelRun {
  id: Id;
  taskId?: Id;
  executionId?: Id;
  /** Logical role: planner | diagnoser | repairer | reviewer | summarizer. */
  role: string;
  model: ModelRunRef;
  promptDigest: string;
  latencyMs: number;
  /** Token usage when the provider reports it. */
  promptTokens?: number;
  completionTokens?: number;
  /** Whether the output satisfied the requested schema on the first try. */
  schemaValid: boolean;
  /** Set when the router had to fall back. */
  fellBackFrom?: string;
  error?: string;
  startedAt: string;
}

export interface FileChange {
  path: string;
  change: "create" | "modify" | "delete";
  /** Bytes added/removed when computable. */
  added?: number;
  removed?: number;
  /** Unified diff hunk, truncated for storage sanity. */
  diff?: string;
  /** sha256 of file contents before and after. */
  beforeHash?: string;
  afterHash?: string;
}

export interface ToolCall {
  id: Id;
  executionId: Id;
  tool: string;
  /** Which permission level the tool required. */
  permission: PermissionLevel;
  input: unknown;
  /** Truncated for storage. Full output remains in the run log. */
  output?: unknown;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  /** Whether this call mutated the workspace. */
  mutating: boolean;
}

export type PermissionLevel = "read" | "write" | "execute" | "dangerous";

export interface TestRun {
  id: Id;
  executionId: Id;
  /** Which verification layer produced it. */
  layer: string;
  command: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  /** Parsed counts when the runner reports them. */
  passed?: number;
  failed?: number;
  total?: number;
  ok: boolean;
}

export interface Failure {
  id: Id;
  executionId: Id;
  /** Machine-readable classification, used to decide repair strategy. */
  classification: FailureClass;
  /** The raw signal (failing assertion, compiler error, ...). */
  signal: string;
  /** Which layer caught it. */
  layer: string;
  /** Model-authored hypothesis, marked as a hypothesis. */
  rootCauseHypothesis?: string;
  rootCauseProvenance?: Provenance;
  /** The repair attempt that resolved it, if any. */
  resolvedByAttempt?: number;
  at: string;
}

export type FailureClass =
  | "test_assertion"
  | "type_error"
  | "lint_error"
  | "build_error"
  | "runtime_error"
  | "timeout"
  | "security"
  | "unknown";

export interface Checkpoint {
  id: Id;
  taskId: Id;
  executionId?: Id;
  /** git ref or opaque handle usable by the rollback tool. */
  ref: string;
  kind: "git_commit" | "git_stash" | "snapshot_dir";
  /** Hashes of tracked files at checkpoint time, for verification of a rollback. */
  treeHash: string;
  createdAt: string;
  reason: string;
  /** Set when this checkpoint was used to revert. */
  restoredAt?: string;
  restoredOk?: boolean;
}

export interface VerificationLayerResult {
  layer: VerificationLayer;
  ok: boolean;
  /** Did this layer actually run, or was it unavailable? */
  ran: boolean;
  command?: string;
  summary: string;
  evidenceRef?: Id;
}

export type VerificationLayer =
  | "typecheck"
  | "lint"
  | "unit"
  | "integration"
  | "e2e"
  | "build"
  | "security"
  | "regression";

export interface VerificationResult {
  id: Id;
  taskId: Id;
  executionId: Id;
  layers: VerificationLayerResult[];
  /** Layer results the developer must be told about because they did NOT run. */
  skipped: string[];
  startedAt: string;
  finishedAt: string;
  /** Computed verdict. Never authored by a model. */
  verdict: Verdict;
  /** Human-readable reasons contributing to the verdict. */
  rationale: string[];
}

export interface Execution {
  id: Id;
  taskId: Id;
  attempt: number;
  planId: Id;
  checkpointId?: Id;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed" | "rolled_back" | "aborted";
  toolCallIds: Id[];
  fileChangeIds: Id[];
  testRunIds: Id[];
  failureIds: Id[];
  modelRunIds: Id[];
  /** Steps the executor actually completed. */
  completedStepIds: Id[];
  verificationId?: Id;
}

/**
 * The Evidence record: the artifact that answers "why should I trust this?".
 * Immutable once sealed.
 */
export interface EvidenceRecord {
  id: Id;
  taskId: Id;
  projectId: Id;
  /** The execution this record describes. */
  executionId: Id;
  /** 1. The developer's original words, verbatim. */
  originalIntent: string;
  /** 2. What the system understood, and any ambiguity it flagged. */
  interpretation: string;
  interpretationProvenance: Provenance;
  /** 3. The plan that was followed. */
  planId: Id;
  planSummary: string[];
  /** 4. What actually changed. */
  changes: FileChange[];
  /** 5. Commands actually executed. */
  commands: { command: string; exitCode: number; layer: string }[];
  /** 6. Tools used, and their permission levels. */
  toolsUsed: { tool: string; count: number; highestPermission: PermissionLevel }[];
  /** 7. Models used — with weight class, so openness is auditable. */
  modelsUsed: ModelRunRef[];
  /** 8. Tests and results. */
  testResults: { layer: string; ok: boolean; passed?: number; failed?: number; summary: string }[];
  /** 9. What went wrong. */
  failures: { classification: FailureClass; signal: string; layer: string; rootCause?: string }[];
  /** 10. How it was repaired. */
  repairs: { attempt: number; description: string; outcome: "resolved" | "unresolved" }[];
  /** 11. Rollbacks performed. */
  rollbacks: { checkpointRef: string; ok: boolean; at: string }[];
  /**
   * 12. Whether the repository's tests exercise each acceptance criterion.
   *
   * Added after an observed failure: a change can pass every check the project declares while
   * implementing none of the request, because the suite describes existing behaviour. This
   * field is how the record distinguishes "the checks passed" from "the thing you asked for
   * was tested".
   */
  acceptanceCoverage: {
    criterion: string;
    covered: boolean;
    signals: string[];
    matchedSignals: string[];
    concrete: boolean;
  }[];
  /** Criteria that name a concrete surface and are referenced by no test. */
  uncoveredCriteria: string[];
  /** 13. The final diff. */
  finalDiff: string;
  /** 13. Verification outcome. */
  verification: VerificationResult;
  /** 14. The verdict and why. */
  verdict: Verdict;
  verdictReasons: string[];
  /** What the developer should still check manually. Never empty when verdict != VERIFIED. */
  residualRisk: string[];
  /** Which model produced the intent→requirement interpretation. */
  generatedAt: string;
  /** Digest over the canonical record, so tampering is detectable. */
  digest: string;
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

export interface Project {
  id: Id;
  name: string;
  root: string;
  createdAt: string;
  updatedAt: string;
  /** Bumped on every analyze; lets evidence cite the world it was judged against. */
  worldRevision: number;
  stack: StackInfo;
  repository: RepositoryInfo;
  commands: ProjectCommand[];
  /** Discovered test files. */
  testFiles: string[];
  /** Discovered entry points / important files. */
  keyFiles: string[];
  /** Bounded directory listing for context building. */
  tree: string[];
  constraints: Constraint[];
  decisions: ArchitectureDecision[];
  /** Facts the analyzer could not determine. Honesty about ignorance. */
  unknowns: string[];
}

export interface ProjectWorld {
  project: Project;
  tasks: Task[];
  plans: Plan[];
  executions: Execution[];
  evidence: EvidenceRecord[];
  checkpoints: Checkpoint[];
  failures: Failure[];
  verifications: VerificationResult[];
  decisions: ArchitectureDecision[];
  /** Long-lived notes the developer or the system wants remembered. */
  memories: MemoryEntry[];
  modelRuns: ModelRun[];
}

export interface MemoryEntry {
  id: Id;
  projectId: Id;
  kind: "fact" | "lesson" | "preference" | "decision";
  text: string;
  provenance: Provenance;
  /** How many times this memory has been retrieved/served to a model. */
  usedCount: number;
  createdAt: string;
}

/** Append-only audit log: every mutation, by whom, under what permission. */
export interface AuditEntry {
  seq: number;
  at: string;
  actor: "runtime" | "model" | "human";
  action: string;
  permission: PermissionLevel;
  taskId?: Id;
  executionId?: Id;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Model router contracts
// ---------------------------------------------------------------------------

export interface ModelCapabilities {
  toolCalling: boolean;
  structuredOutput: boolean;
  /** Max context the provider will accept. */
  contextWindow: number;
  /** Roughly how capable at code reasoning, 0..1, measured by our own probe. */
  codeStrength: number;
  offline: boolean;
}

export interface ModelDescriptor {
  id: string;
  provider: string;
  weightClass: "open-weight" | "proprietary" | "unknown";
  capabilities: ModelCapabilities;
  /** Lower is cheaper. 0 for local. */
  costTier: number;
}

export interface ModelRequest {
  role: string;
  system: string;
  prompt: string;
  /** JSON schema when the caller needs structured output. */
  schema?: unknown;
  maxTokens?: number;
  temperature?: number;
  /** Prefer offline/private models when true. */
  privacySensitive?: boolean;
  /** Prefer stronger models when true. */
  difficulty?: "low" | "medium" | "high";
}

export interface ModelResponse<T = unknown> {
  text: string;
  parsed?: T;
  model: ModelRunRef;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  schemaValid: boolean;
  fellBackFrom?: string;
}

export interface ModelProvider {
  readonly name: string;
  listModels(): Promise<ModelDescriptor[]>;
  /** Whether the provider is reachable right now. */
  available(): Promise<boolean>;
  complete(req: ModelRequest, modelId: string): Promise<ModelResponse>;
}
