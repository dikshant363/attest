import { z } from "zod";
import type { ModelRouter } from "@attest/model-router";
import type {
  Plan,
  PlanStep,
  Project,
  Provenance,
  Requirement,
  Task,
} from "@attest/shared";
import { newId, nowIso } from "@attest/shared";
import {
  EDITOR_SYSTEM,
  INTERPRETER_SYSTEM,
  PLANNER_SYSTEM,
  READ_REQUEST_SYSTEM,
  REPAIR_SYSTEM,
  UNTRUSTED_CONTENT_NOTICE,
  renderProjectContext,
  type ProjectContextInput,
} from "./prompts.ts";

/** Every system prompt carries the untrusted-content notice. There is no opt-out. */
function harden(system: string): string {
  return `${system}\n${UNTRUSTED_CONTENT_NOTICE}`;
}

// ---------------------------------------------------------------------------
// Output contracts
// ---------------------------------------------------------------------------

const InterpretSchema = z.object({
  restatement: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
  ambiguities: z.array(z.string()).default([]),
  outOfScope: z.array(z.string()).default([]),
  riskNotes: z.array(z.string()).default([]),
});

const PlannerSchema = z.object({
  steps: z
    .array(
      z.object({
        kind: z.enum(["investigate", "edit", "create", "delete", "run_command", "verify"]),
        description: z.string().min(1),
        targets: z.array(z.string()).default([]),
        command: z.string().optional(),
        required: z.boolean().default(true),
      }),
    )
    .min(1),
  risks: z.array(z.string()).default([]),
  verificationStrategy: z.array(z.string()).default([]),
});

const EditSchema = z.object({
  reasoning: z.string().default(""),
  edits: z
    .array(
      z
        .object({
          path: z.string().min(1),
          content: z.string().optional(),
          search: z.string().optional(),
          replace: z.string().optional(),
        })
        .refine((e) => e.content !== undefined || (e.search !== undefined && e.replace !== undefined), {
          message: "each edit needs either content, or both search and replace",
        }),
    )
    .default([]),
});

const ReadRequestSchema = z.object({
  filesToRead: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

const RepairSchema = z.object({
  rootCause: z.string().default(""),
  reasoning: z.string().default(""),
  edits: z
    .array(
      z
        .object({
          path: z.string().min(1),
          content: z.string().optional(),
          search: z.string().optional(),
          replace: z.string().optional(),
        })
        .refine((e) => e.content !== undefined || (e.search !== undefined && e.replace !== undefined), {
          message: "each edit needs either content, or both search and replace",
        }),
    )
    .default([]),
});

export type InterpretOutput = z.infer<typeof InterpretSchema>;
export type EditOutput = z.infer<typeof EditSchema>;
export type RepairOutput = z.infer<typeof RepairSchema>;

function describeIssues(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  }
  return String(err);
}

/**
 * The agent team.
 *
 * Each role has one job, a strict output contract, and a bounded retry that feeds the
 * validation error back to the model. Small open-weight models fail schema compliance
 * often enough that "ask once and hope" is not an engineering strategy.
 *
 * No role is ever asked to evaluate its own work. Evaluation happens in the
 * VerificationEngine, by executing commands.
 */
export class AgentTeam {
  constructor(
    private readonly router: ModelRouter,
    private readonly maxSchemaRetries = 2,
  ) {}

  /**
   * Run a structured model call, validating and retrying on schema failure.
   * Exposed so every role shares one reliability policy.
   */
  private async structured<S extends z.ZodTypeAny>(
    args: {
      role: string;
      system: string;
      prompt: string;
      schema: S;
      difficulty?: "low" | "medium" | "high";
      privacySensitive?: boolean;
      maxTokens?: number;
    },
    opts: { excludeProviders?: string[]; excludeModels?: string[] } = {},
  ): Promise<{ value: z.infer<S>; model: { modelId: string; provider: string; weightClass: "open-weight" | "proprietary" | "unknown" }; attempts: number; raw: string }> {
    let prompt = args.prompt;
    let lastError = "";
    let lastRaw = "";

    for (let attempt = 0; attempt <= this.maxSchemaRetries; attempt++) {
      const res = await this.router.complete<unknown>(
        {
          role: args.role,
          system: args.system,
          prompt,
          schema: { type: "object" },
          difficulty: args.difficulty,
          privacySensitive: args.privacySensitive,
          maxTokens: args.maxTokens,
          temperature: attempt === 0 ? 0.1 : 0.0,
        },
        opts,
      );
      lastRaw = res.text;

      const parsedCandidate = res.parsed ?? tryJson(res.text);
      const validation = args.schema.safeParse(parsedCandidate);
      if (validation.success) {
        return { value: validation.data, model: res.model, attempts: attempt + 1, raw: res.text };
      }
      lastError = describeIssues(validation.error);
      prompt =
        `${args.prompt}\n\n---\nYour previous response could not be parsed.\n` +
        `Validation error: ${lastError}\n` +
        `Previous response:\n${res.text.slice(0, 1500)}\n\n` +
        `Reply again with JSON only, matching the required shape exactly.`;
    }

    throw new Error(
      `model failed to produce valid ${args.role} output after ${this.maxSchemaRetries + 1} attempts: ${lastError}\n` +
        `last raw response:\n${lastRaw.slice(0, 1200)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Interpreter: intent -> testable requirement
  // -------------------------------------------------------------------------

  async interpret(
    intent: string,
    context: ProjectContextInput,
  ): Promise<{ requirement: Requirement; interpretation: string; provenance: Provenance; ambiguities: string[]; outOfScope: string[]; riskNotes: string[] }> {
    const prompt = [
      renderProjectContext(context),
      "## Request",
      intent,
      "",
      "Restate this as testable acceptance criteria.",
    ].join("\n");

    const { value, model, attempts } = await this.structured({
      role: "interpreter",
      system: harden(INTERPRETER_SYSTEM),
      prompt,
      schema: InterpretSchema,
      difficulty: "low",
      privacySensitive: true,
      maxTokens: 1200,
    });

    const requirement: Requirement = {
      id: newId("req"),
      text: intent,
      acceptanceCriteria: value.acceptanceCriteria,
      provenance: {
        source: "model",
        confidence: value.ambiguities.length === 0 ? 0.8 : 0.55,
        modelId: model.modelId,
        at: nowIso(),
        note: `schema attempts: ${attempts}`,
      },
    };

    return {
      requirement,
      interpretation: value.restatement,
      provenance: requirement.provenance,
      ambiguities: value.ambiguities,
      outOfScope: value.outOfScope,
      riskNotes: value.riskNotes,
    };
  }

  // -------------------------------------------------------------------------
  // Planner
  // -------------------------------------------------------------------------

  async plan(
    task: Task,
    context: ProjectContextInput,
    difficulty: "low" | "medium" | "high" = "medium",
  ): Promise<Plan> {
    const prompt = [
      renderProjectContext(context),
      "## Acceptance criteria",
      ...task.intent.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
      "",
      "## Request",
      task.intent.text,
      "",
      "Produce the plan.",
    ].join("\n");

    const { value, model } = await this.structured({
      role: "planner",
      system: harden(PLANNER_SYSTEM),
      prompt,
      schema: PlannerSchema,
      difficulty,
      privacySensitive: true,
      maxTokens: 1600,
    });

    const steps: PlanStep[] = value.steps.map((s, index) => ({
      id: newId("step"),
      index,
      kind: s.kind,
      description: s.description,
      targets: s.targets,
      command: s.command,
      required: s.required,
    }));

    return {
      id: newId("plan"),
      taskId: task.id,
      steps,
      risks: value.risks,
      verificationStrategy: value.verificationStrategy,
      producedBy: model,
      createdAt: nowIso(),
    };
  }

  // -------------------------------------------------------------------------
  // Implementer — investigation phase
  // -------------------------------------------------------------------------

  async requestReads(
    task: Task,
    plan: Plan,
    context: ProjectContextInput,
  ): Promise<{ files: string[]; notes: string; modelId: string }> {
    const available = new Set(context.project.tree);
    const prompt = [
      renderProjectContext(context),
      "## Acceptance criteria",
      ...task.intent.acceptanceCriteria.map((c) => `- ${c}`),
      "",
      "## Plan",
      ...plan.steps.map((s) => `${s.index + 1}. [${s.kind}] ${s.description}`),
      "",
      "Which existing files must you read before writing edits?",
    ].join("\n");

    try {
      const { value, model } = await this.structured({
        role: "interpreter",
        system: harden(READ_REQUEST_SYSTEM),
        prompt,
        schema: ReadRequestSchema,
        difficulty: "low",
        privacySensitive: true,
        maxTokens: 600,
      });
      // Never let the model invent a path; only real files can be read.
      const files = value.filesToRead.filter((f) => available.has(f)).slice(0, 6);
      // Fall back to the plan's own targets, which are also validated.
      if (files.length === 0) {
        for (const s of plan.steps) {
          for (const t of s.targets) if (available.has(t) && !files.includes(t)) files.push(t);
        }
      }
      return { files: files.slice(0, 6), notes: value.notes, modelId: model.modelId };
    } catch {
      // Investigation is an optimisation, not a requirement. Degrade to plan targets.
      const files = plan.steps.flatMap((s) => s.targets).filter((t) => available.has(t)).slice(0, 6);
      return { files, notes: "read-request step failed; using plan targets", modelId: "none" };
    }
  }

  // -------------------------------------------------------------------------
  // Implementer — edit phase
  // -------------------------------------------------------------------------

  async edit(
    task: Task,
    plan: Plan,
    context: ProjectContextInput,
    difficulty: "low" | "medium" | "high" = "medium",
  ): Promise<{ output: EditOutput; modelId: string; provider: string; weightClass: string }> {
    const prompt = [
      renderProjectContext(context),
      "## Acceptance criteria",
      ...task.intent.acceptanceCriteria.map((c) => `- ${c}`),
      "",
      "## Plan to implement",
      ...plan.steps.map((s) => `${s.index + 1}. [${s.kind}] ${s.description}${s.targets.length ? ` → ${s.targets.join(", ")}` : ""}`),
      "",
      "Implement the plan. Return the edits.",
    ].join("\n");

    const { value, model } = await this.structured({
      role: "repairer",
      system: harden(EDITOR_SYSTEM),
      prompt,
      schema: EditSchema,
      difficulty,
      privacySensitive: true,
      maxTokens: 4000,
    });
    return { output: value, modelId: model.modelId, provider: model.provider, weightClass: model.weightClass };
  }

  // -------------------------------------------------------------------------
  // Repairer
  // -------------------------------------------------------------------------

  async repair(args: {
    task: Task;
    plan: Plan;
    context: ProjectContextInput;
    failureSignal: string;
    failedLayer: string;
    previousEdits: { path: string; content?: string; search?: string; replace?: string }[];
  }): Promise<{ output: RepairOutput; modelId: string; provider: string; weightClass: string }> {
    const { task, plan, context, failureSignal, failedLayer, previousEdits } = args;
    const prompt = [
      renderProjectContext(context),
      "## Acceptance criteria",
      ...task.intent.acceptanceCriteria.map((c) => `- ${c}`),
      "",
      "## Plan",
      ...plan.steps.map((s) => `${s.index + 1}. [${s.kind}] ${s.description}`),
      "",
      `## The change that was applied and then ROLLED BACK (layer "${failedLayer}" failed)`,
      JSON.stringify(previousEdits, null, 2).slice(0, 6000),
      "",
      "## Exact failure output",
      "```",
      failureSignal.slice(0, 5000),
      "```",
      "",
      "The workspace is back at its pre-change state, shown in the file contents above.",
      "Produce corrected edits that satisfy the acceptance criteria WITHOUT breaking any constraint.",
    ].join("\n");

    const { value, model } = await this.structured({
      role: "repairer",
      system: harden(REPAIR_SYSTEM),
      prompt,
      schema: RepairSchema,
      // Repair is the hardest step; allow escalation to the strongest open-weight model.
      difficulty: "high",
      privacySensitive: true,
      maxTokens: 4000,
    });
    return { output: value, modelId: model.modelId, provider: model.provider, weightClass: model.weightClass };
  }

  /**
   * Independent review is deliberately routed away from the model that wrote the code.
   * A model reviewing its own output adds latency and very little signal.
   */
  async review(args: {
    task: Task;
    diff: string;
    context: ProjectContextInput;
    authorModelId: string;
    authorProvider: string;
  }): Promise<{ concerns: string[]; modelId: string; note: string }> {
    const prompt = [
      renderProjectContext(args.context),
      "## Acceptance criteria",
      ...args.task.intent.acceptanceCriteria.map((c) => `- ${c}`),
      "",
      "## Diff under review",
      "```diff",
      args.diff.slice(0, 12_000),
      "```",
      "",
      "List concrete concerns only. If you see none, return an empty list. Do not restate the diff.",
    ].join("\n");

    const ReviewSchema = z.object({
      concerns: z.array(z.string()).default([]),
      note: z.string().default(""),
    });

    const { value, model } = await this.structured(
      {
        role: "reviewer",
        system: harden(
          "You are an independent reviewer. You did not write this code. Report only concrete, verifiable concerns about correctness, security or constraint violations. Reply with JSON: {\"concerns\": [\"...\"], \"note\": \"...\"}",
        ),
        prompt,
        schema: ReviewSchema,
        difficulty: "medium",
        maxTokens: 1000,
      },
      { excludeModels: [args.authorModelId], excludeProviders: [args.authorProvider] },
    );
    return { concerns: value.concerns, modelId: model.modelId, note: value.note };
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
