import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type {
  Project,
  TestRun,
  VerificationLayer,
  VerificationLayerResult,
  VerificationResult,
  Verdict,
} from "@attest/shared";
import { newId, nowIso, runCommand, truncate } from "@attest/shared";
import { failureExcerpt, parseTestOutput, type ParsedCounts } from "./parse.ts";
import { isBlocking, scanChanges, type SecurityFinding } from "./security.ts";
import { assessAcceptanceCoverage, looksLikeTestFile, type CoverageReport } from "./coverage.ts";

/** The repository's own health before we touch anything. */
export interface Baseline {
  capturedAt: string;
  green: boolean;
  command?: string;
  passed?: number;
  failed?: number;
  total?: number;
  failures: string[];
  /** True when no test command exists at all. */
  noTestsDeclared: boolean;
}

export interface LayerRun {
  layer: VerificationLayer;
  result: VerificationLayerResult;
  testRun?: TestRun;
  parsed?: ParsedCounts;
  findings?: SecurityFinding[];
}

export interface VerificationOptions {
  taskId: string;
  /** Restatements of the request, used to check that something tests them. */
  acceptanceCriteria?: string[];
  executionId: string;
  /** Repo-relative paths this task changed. Security scanning is scoped to these. */
  changedPaths: string[];
  baseline?: Baseline;
  /** Absolute or relative timeout applied to each command layer. */
  timeoutMs?: number;
  /** Called as each layer starts, so the CLI can narrate progress live. */
  onLayer?: (layer: VerificationLayer, status: "start" | "done", ok?: boolean) => void;
}

export interface VerificationOutcome {
  verification: VerificationResult;
  layers: LayerRun[];
  findings: SecurityFinding[];
  /** The single most useful text to hand to a diagnosis model. */
  failureSignal: string;
  /** Which acceptance criteria are exercised by the repository's tests. */
  coverage: CoverageReport;
}

const REQUIRED_LAYERS: VerificationLayer[] = ["security", "unit"];
const OPTIONAL_LAYERS: VerificationLayer[] = ["typecheck", "lint", "build", "e2e", "regression"];

/**
 * The Verification Engine.
 *
 * Rule: you may only say "verified" about something you actually executed and observed.
 * Layers that cannot run are reported as skipped — never silently treated as passing.
 * A model's opinion is not a layer.
 */
export class VerificationEngine {
  constructor(
    private readonly root: string,
    private readonly project: Project,
  ) {}

  private commandFor(kind: string): string | undefined {
    return this.project.commands.find((c) => c.kind === kind)?.command;
  }

  /**
   * Run the project's own test command before any mutation.
   * This is what lets Attest distinguish "I broke it" from "it was already broken".
   */
  async captureBaseline(timeoutMs = 300_000): Promise<Baseline> {
    const testCmd = this.commandFor("test");
    if (!testCmd) {
      return {
        capturedAt: nowIso(),
        green: false,
        noTestsDeclared: true,
        failures: [],
      };
    }
    const res = await runCommand(testCmd, { cwd: this.root, timeoutMs });
    const parsed = parseTestOutput(res.stdout, res.stderr);
    return {
      capturedAt: nowIso(),
      green: res.exitCode === 0,
      command: testCmd,
      passed: parsed.passed,
      failed: parsed.failed,
      total: parsed.total,
      failures: parsed.failures,
      noTestsDeclared: false,
    };
  }

  async run(opts: VerificationOptions): Promise<VerificationOutcome> {
    const layers: LayerRun[] = [];
    const startedAt = nowIso();
    const timeoutMs = opts.timeoutMs ?? 300_000;

    const runCommandLayer = async (layer: VerificationLayer, kind: string): Promise<LayerRun | undefined> => {
      const command = this.commandFor(kind);
      if (!command) return undefined;
      opts.onLayer?.(layer, "start");
      const res = await runCommand(command, { cwd: this.root, timeoutMs });
      const parsed = parseTestOutput(res.stdout, res.stderr);
      const testRun: TestRun = {
        id: newId("test"),
        executionId: opts.executionId,
        layer,
        command,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
        stdout: truncate(res.stdout, 12_000),
        stderr: truncate(res.stderr, 12_000),
        passed: parsed.passed,
        failed: parsed.failed,
        total: parsed.total,
        ok: res.exitCode === 0,
      };
      const summary =
        parsed.total !== undefined
          ? `${parsed.passed ?? 0}/${parsed.total} passing`
          : res.exitCode === 0
            ? "exited 0"
            : `exited ${res.exitCode}`;
      const result: VerificationLayerResult = {
        layer,
        ok: res.exitCode === 0,
        ran: true,
        command,
        summary,
        evidenceRef: testRun.id,
      };
      opts.onLayer?.(layer, "done", result.ok);
      return { layer, result, testRun, parsed };
    };

    const skip = (layer: VerificationLayer, summary: string): LayerRun => ({
      layer,
      result: { layer, ok: false, ran: false, summary },
    });

    // --- security: always runs, always in-process ---------------------------
    opts.onLayer?.("security", "start");
    const changed = opts.changedPaths.map((p) => ({ path: p }));
    const { findings, skipped } = scanChanges(changed, (p) => readSync(path.join(this.root, p)));
    const blocking = findings.filter(isBlocking);
    const securityRun: LayerRun = {
      layer: "security",
      result: {
        layer: "security",
        ok: blocking.length === 0,
        ran: true,
        summary:
          findings.length === 0
            ? `no findings in ${changed.length} changed file(s)` +
              (skipped.length ? ` (${skipped.length} exempt)` : "")
            : `${findings.length} finding(s), ${blocking.length} blocking`,
      },
      findings,
    };
    opts.onLayer?.("security", "done", securityRun.result.ok);
    layers.push(securityRun);

    // --- unit ---------------------------------------------------------------
    const unit = await runCommandLayer("unit", "test");
    layers.push(
      unit ?? skip("unit", "no test command declared by this project — cannot claim 'tested'"),
    );

    // --- typecheck / lint / build / e2e ------------------------------------
    for (const [layer, kind] of [
      ["typecheck", "typecheck"],
      ["lint", "lint"],
      ["build", "build"],
      ["e2e", "e2e"],
    ] as [VerificationLayer, string][]) {
      const r = await runCommandLayer(layer, kind);
      layers.push(r ?? skip(layer, `no ${kind} command declared`));
    }

    // --- regression: did previously-passing behaviour survive? -------------
    if (opts.baseline && !opts.baseline.noTestsDeclared && this.commandFor("test")) {
      const unitRun = layers.find((l) => l.layer === "unit");
      const passedNow = unitRun?.parsed?.passed;
      const basePassed = opts.baseline.passed;
      const baseGreen = opts.baseline.green;
      const greenNow = unitRun?.result.ok ?? false;

      let ok: boolean;
      let summary: string;
      if (!baseGreen) {
        ok = false;
        summary = `baseline was already red (${opts.baseline.failed ?? "?"} failing before this change); regression cannot be ruled out`;
      } else if (basePassed !== undefined && passedNow !== undefined && passedNow < basePassed) {
        ok = false;
        summary = `passing tests dropped from ${basePassed} to ${passedNow}`;
      } else if (!greenNow) {
        ok = false;
        summary = "test suite does not pass after the change";
      } else {
        ok = true;
        summary = `baseline preserved (${basePassed ?? "?"} → ${passedNow ?? "?"} passing)`;
      }
      layers.push({
        layer: "regression",
        result: { layer: "regression", ok, ran: true, command: this.commandFor("test"), summary },
      });
    } else {
      layers.push(
        skip(
          "regression",
          opts.baseline?.noTestsDeclared
            ? "no baseline test suite exists to regress"
            : "no baseline was captured",
        ),
      );
    }

    // Did anything in this repository actually exercise what the task asked for?
    // The analysed test list plus any test file this task just created, so that an agent
    // adding a test for the behaviour it built is credited for it.
    const testFiles = [
      ...new Set([
        ...this.project.testFiles,
        ...opts.changedPaths.filter((p) => looksLikeTestFile(p)),
      ]),
    ];
    const coverage = assessAcceptanceCoverage(
      opts.acceptanceCriteria ?? [],
      testFiles,
      (f) => readSync(path.join(this.root, f)),
      { knownCommands: this.project.commands.map((c) => c.command) },
    );

    const finishedAt = nowIso();
    const { verdict, rationale } = computeVerdict(layers, coverage);

    const verification: VerificationResult = {
      id: newId("ver"),
      taskId: opts.taskId,
      executionId: opts.executionId,
      layers: layers.map((l) => l.result),
      skipped: layers.filter((l) => !l.result.ran).map((l) => `${l.layer}: ${l.result.summary}`),
      startedAt,
      finishedAt,
      verdict,
      rationale,
    };

    const failingLayer = layers.find((l) => REQUIRED_LAYERS.includes(l.layer) && !l.result.ok && l.result.ran);
    const anyFailing = failingLayer ?? layers.find((l) => l.result.ran && !l.result.ok);
    const failureSignal = anyFailing?.testRun
      ? failureExcerpt(anyFailing.testRun.stdout, anyFailing.testRun.stderr)
      : blocking.length
        ? blocking.map((f) => `${f.path}:${f.line} [${f.rule}] ${f.excerpt}`).join("\n")
        : "";

    return { verification, layers, findings, failureSignal, coverage };
  }
}

/**
 * Compute the verdict. This function is the only place a verdict is produced, and it
 * is pure: given the same layer results it always returns the same answer. A model
 * can influence the *inputs* (by writing code) but never the verdict itself.
 */
export function computeVerdict(
  layers: LayerRun[],
  coverage?: Pick<CoverageReport, "uncoveredConcrete" | "unassessable">,
): { verdict: Verdict; rationale: string[] } {
  const rationale: string[] = [];
  const byLayer = new Map(layers.map((l) => [l.layer, l]));

  const requiredFailed: string[] = [];
  const requiredSkipped: string[] = [];
  const optionalFailed: string[] = [];
  const optionalSkipped: string[] = [];

  for (const layer of [...REQUIRED_LAYERS, ...OPTIONAL_LAYERS]) {
    const l = byLayer.get(layer);
    if (!l) continue;
    const isRequired = REQUIRED_LAYERS.includes(layer);
    if (!l.result.ran) {
      if (isRequired) requiredSkipped.push(`${layer} (${l.result.summary})`);
      else optionalSkipped.push(layer);
      continue;
    }
    if (!l.result.ok) {
      if (isRequired) requiredFailed.push(`${layer}: ${l.result.summary}`);
      else optionalFailed.push(`${layer}: ${l.result.summary}`);
    } else {
      rationale.push(`✓ ${layer}: ${l.result.summary}`);
    }
  }

  for (const s of requiredSkipped) rationale.push(`— required layer did not run: ${s}`);

  if (requiredFailed.length > 0) {
    return {
      verdict: "UNVERIFIED",
      rationale: [...rationale, ...requiredFailed.map((f) => `✗ ${f}`)],
    };
  }
  if (requiredSkipped.length > 0) {
    // The project gave us nothing to execute. We must not call that verified.
    return {
      verdict: "UNVERIFIED",
      rationale: [...rationale, "✗ no required layer could execute, so nothing was verified"],
    };
  }
  if (optionalFailed.length > 0) {
    return {
      verdict: "PARTIALLY_VERIFIED",
      rationale: [...rationale, ...optionalFailed.map((f) => `⚠ ${f}`)],
    };
  }
  const skippedNote = optionalSkipped.length
    ? [`not checked (not declared by this project): ${optionalSkipped.join(", ")}`]
    : [];

  // The final gate: every check passed, but did anything check what was actually asked for?
  //
  // A change can pass a repository's entire suite while implementing none of the request,
  // because the suite describes existing behaviour. Reporting VERIFIED there would be
  // technically accurate and practically misleading — the exact failure this project exists
  // to prevent. So an acceptance criterion that names a concrete surface (a route, a quoted
  // literal) and is referenced by no test caps the verdict at PARTIALLY_VERIFIED.
  if (coverage && !coverage.unassessable && coverage.uncoveredConcrete.length > 0) {
    return {
      verdict: "PARTIALLY_VERIFIED",
      rationale: [
        ...rationale,
        ...skippedNote,
        ...coverage.uncoveredConcrete.map(
          (c) => `⚠ no test exercises this acceptance criterion: "${truncateCriterion(c)}"`,
        ),
        "⚠ every executed check passed, but at least one requested behaviour is untested, so the change cannot be called fully verified",
      ],
    };
  }

  return {
    verdict: "VERIFIED",
    rationale: [...rationale, ...skippedNote],
  };
}

function truncateCriterion(c: string): string {
  return c.length > 110 ? `${c.slice(0, 107)}…` : c;
}

function readSync(file: string): string | undefined {
  try {
    // A synchronous read is correct here: the security layer must observe the file
    // exactly as it is at verification time, and the content is already in the page
    // cache immediately after the edit that produced it.
    const stat = fsSync.statSync(file);
    if (stat.size > 800_000) return undefined;
    return fsSync.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
