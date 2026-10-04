/**
 * End-to-end tests for the autonomous loop.
 *
 * These are the tests that matter most, because they exercise the claim the whole project
 * rests on: given a change that breaks the repository's own tests, the runtime detects the
 * failure, rolls the workspace back to a verified known-good state, repairs, re-verifies,
 * and produces a sealed evidence record — without a human in the loop.
 *
 * A deterministic mock model is used for the interpretation and planning turns so the test
 * does not depend on a model being installed. The edit and repair turns use recorded change
 * sets, and everything after them — checkpoints, real subprocess test runs, rollback
 * verification, verdicts, evidence sealing — is the genuine runtime.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AttestRuntime } from "@attest/core";
import { ModelRouter, MockProvider, loadRouterConfig } from "@attest/model-router";
import { verifyEvidenceDigest } from "@attest/evidence";
import { DEMO_REGRESSION, DEMO_REPAIR, DEMO_TASK } from "../packages/cli/src/demo-scenario.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "examples", "auth-fixture");
const TMP_BASE = path.join(ROOT, ".e2e-tmp");

/** A model that answers each role correctly, so planning never blocks the test. */
function mockRouter(): ModelRouter {
  const router = new ModelRouter(loadRouterConfig({ ATTEST_DISABLE_GATEWAY: "1", ATTEST_OFFLINE: "1" }));
  const mock = new MockProvider(["mock-open-weight"]);
  mock.queue((req) => {
    if (req.role === "interpreter") {
      return JSON.stringify({
        restatement:
          "Add session-based authentication to the service while keeping the platform health check reachable without a session.",
        acceptanceCriteria: [
          "POST /api/login accepts valid credentials and establishes a session",
          "GET /api/me returns the authenticated user",
          "GET /health remains reachable without a session",
        ],
        ambiguities: [],
        outOfScope: ["persistent session storage"],
        riskNotes: ["A guard applied too broadly will lock out the health check"],
      });
    }
    if (req.role === "planner") {
      return JSON.stringify({
        steps: [
          {
            kind: "edit",
            description: "Add session authentication scoped to the API surface",
            targets: ["src/app.ts"],
            required: true,
          },
          {
            kind: "verify",
            description: "Run the project's test suite and type checker",
            command: "npm test",
            targets: [],
            required: true,
          },
        ],
        risks: ["The health check must stay public"],
        verificationStrategy: ["npm test", "npm run typecheck"],
      });
    }
    if (req.role === "reviewer") {
      return JSON.stringify({ concerns: [], note: "no concerns" });
    }
    return JSON.stringify({});
  });
  router.useMockProvider(mock);
  return router;
}

async function copyFixture(name: string): Promise<string> {
  await fs.mkdir(TMP_BASE, { recursive: true });
  const dest = path.join(TMP_BASE, name);
  await fs.rm(dest, { recursive: true, force: true });
  // Exclude any .attest directory: a local run may have left a Project World in the source
  // fixture, and a test must start from a clean repository.
  await fs.cp(FIXTURE, dest, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes(".attest"),
  });
  return dest;
}

async function readFixtureFile(dir: string, rel: string): Promise<string> {
  return fs.readFile(path.join(dir, rel), "utf8");
}

async function runFixtureTests(dir: string): Promise<{ ok: boolean; output: string }> {
  const { runCommand } = await import("@attest/shared");
  const res = await runCommand("npm test", { cwd: dir, timeoutMs: 120_000 });
  return { ok: res.exitCode === 0, output: `${res.stdout}\n${res.stderr}` };
}

beforeAll(async () => {
  // The end-to-end tests assert against a pristine source repository, and the demonstration
  // deliberately modifies it. Running `attest demo` and then the test suite without resetting
  // produces failures that look like logic bugs but are just a dirty fixture — so fail with
  // the fix instead.
  const appSource = await fs.readFile(path.join(FIXTURE, "src", "app.ts"), "utf8");
  if (!appSource.includes("TODO: sessions are not implemented yet")) {
    throw new Error(
      "examples/auth-fixture is not pristine — a previous run modified it.\n" +
        "Fix it with:  npm run fixture:reset",
    );
  }
  await fs.rm(TMP_BASE, { recursive: true, force: true });
  await fs.mkdir(TMP_BASE, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP_BASE, { recursive: true, force: true });
});

describe("end-to-end: a change that fails, and recovers", () => {
  test(
    "detects the regression, rolls back with proof, repairs, re-verifies, and seals evidence",
    async () => {
      const workDir = await copyFixture("recover");
      const runtime = AttestRuntime.for({ root: workDir, router: mockRouter() });

      const init = await runtime.init();
      expect(init.store.project.commands.some((c) => c.kind === "test")).toBe(true);

      const pristine = await readFixtureFile(workDir, "src/app.ts");
      expect(pristine).toContain("TODO: sessions are not implemented yet");

      const result = await runtime.runTask(DEMO_TASK, {
        maxAttempts: 2,
        skipReview: true,
        injectRegression: DEMO_REGRESSION,
        injectRepair: DEMO_REPAIR,
      });

      const { task, evidence } = result;

      // --- the verdict is the one we expect -----------------------------
      expect(task.verdict).toBe("VERIFIED");
      expect(evidence.verdict).toBe("VERIFIED");

      // --- a real failure was observed and classified -------------------
      expect(evidence.failures.length).toBeGreaterThanOrEqual(1);
      const failure = evidence.failures[0]!;
      expect(failure.classification).toBe("test_assertion");
      expect(failure.layer).toBe("unit");
      // The signal must be the real assertion output, not an empty string.
      expect(failure.signal.length).toBeGreaterThan(10);
      expect(failure.signal).toMatch(/not ok|health|expected/i);

      // --- the workspace was rolled back, and the rollback was verified ---
      expect(evidence.rollbacks.length).toBeGreaterThanOrEqual(1);
      expect(evidence.rollbacks.every((r) => r.ok)).toBe(true);

      // --- a repair was attempted and resolved ---------------------------
      expect(evidence.repairs.length).toBeGreaterThanOrEqual(1);
      expect(evidence.repairs.some((r) => r.outcome === "resolved")).toBe(true);

      // --- layered verification actually ran ------------------------------
      const layers = evidence.verification.layers;
      const unit = layers.find((l) => l.layer === "unit");
      const typecheck = layers.find((l) => l.layer === "typecheck");
      const security = layers.find((l) => l.layer === "security");
      expect(unit?.ran).toBe(true);
      expect(unit?.ok).toBe(true);
      expect(typecheck?.ran).toBe(true);
      expect(security?.ran).toBe(true);
      // Layers the project does not declare are reported as skipped, never as passing.
      expect(evidence.verification.skipped.some((s) => s.startsWith("lint"))).toBe(true);

      // --- the change landed and is correct -------------------------------
      expect(evidence.changes.some((c) => c.path === "src/app.ts")).toBe(true);
      expect(evidence.changes.some((c) => c.path.includes("requireAuth"))).toBe(true);
      const finalApp = await readFixtureFile(workDir, "src/app.ts");
      expect(finalApp).toContain("requireAuth");
      expect(finalApp).toContain('req.path === "/health"');
      // Scoped to the API surface, which is the whole lesson of the demonstration.
      expect(finalApp).toContain('req.path.startsWith("/api/")');

      // --- the repository's own tests really do pass in the final state ---
      const fixtureResult = await runFixtureTests(workDir);
      expect(fixtureResult.ok, fixtureResult.output.slice(-2000)).toBe(true);

      // --- the evidence seal is intact ------------------------------------
      const seal = verifyEvidenceDigest(evidence);
      expect(seal.valid).toBe(true);

      // --- the runtime only used open-weight models -----------------------
      expect(evidence.modelsUsed.length).toBeGreaterThan(0);
      expect(evidence.modelsUsed.every((m) => m.weightClass === "open-weight")).toBe(true);

      // --- the audit trail records the safety-critical steps ---------------
      const audit = await init.store.readAudit(500);
      const actions = audit.map((a) => a.action);
      expect(actions).toContain("checkpoint.create");
      expect(actions).toContain("checkpoint.restore");
      expect(actions).toContain("failure.detected");
      expect(actions).toContain("evidence.seal");
      const rollbackEntry = audit.find((a) => a.action === "checkpoint.restore");
      expect(rollbackEntry?.detail).toMatch(/ok=true/);
    },
    240_000,
  );

  test(
    "when the repair also fails, the workspace is left at the known-good state and the verdict says so",
    async () => {
      const workDir = await copyFixture("unrecoverable");
      const runtime = AttestRuntime.for({ root: workDir, router: mockRouter() });
      await runtime.init();

      const pristine = await readFixtureFile(workDir, "src/app.ts");

      // A "repair" that reintroduces the same regression: the loop must not accept it, and
      // must not leave the repository in the broken state.
      const result = await runtime.runTask(DEMO_TASK, {
        maxAttempts: 2,
        skipReview: true,
        injectRegression: DEMO_REGRESSION,
        injectRepair: DEMO_REGRESSION,
      });

      expect(result.task.verdict).toBe("ROLLED_BACK");
      expect(result.evidence.verdict).toBe("ROLLED_BACK");

      // The decisive property: the workspace is bit-for-bit the state we started from.
      const after = await readFixtureFile(workDir, "src/app.ts");
      expect(after).toBe(pristine);
      await expect(fs.access(path.join(workDir, "src", "middleware"))).rejects.toThrow();

      // And the repository's own tests still pass, i.e. nothing was left broken.
      const fixtureResult = await runFixtureTests(workDir);
      expect(fixtureResult.ok, fixtureResult.output.slice(-2000)).toBe(true);

      // The residual risk must tell the developer that nothing was applied.
      expect(result.evidence.residualRisk.some((r) => /rolled back/i.test(r))).toBe(true);
      expect(verifyEvidenceDigest(result.evidence).valid).toBe(true);
    },
    240_000,
  );

  test(
    "a blocked task still produces an evidence record, so failures are auditable too",
    async () => {
      const workDir = await copyFixture("blocked");
      const router = mockRouter();
      // Make the planner fail schema validation on every attempt.
      const broken = new MockProvider(["broken"]);
      broken.queue(() => "not json at all");
      router.useMockProvider(broken);

      const runtime = AttestRuntime.for({ root: workDir, router });
      await runtime.init();

      await expect(
        runtime.runTask(DEMO_TASK, { maxAttempts: 1, skipReview: true }),
      ).rejects.toThrow(/planner/);

      // The task was created and persisted before the planner failed, so the failure is
      // visible in the world rather than lost.
      const store = await runtime.open();
      expect(store.data.tasks.length).toBe(1);
      expect(store.data.tasks[0]!.intent.text).toBe(DEMO_TASK);
    },
    240_000,
  );
});

describe("end-to-end: verification refuses to overclaim", () => {
  test("a project with no tests cannot reach VERIFIED", async () => {
    const workDir = path.join(TMP_BASE, "no-tests");
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.mkdir(path.join(workDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(workDir, "package.json"),
      JSON.stringify({ name: "no-tests", type: "module", scripts: { start: "node src/index.js" } }, null, 2),
      "utf8",
    );
    await fs.writeFile(path.join(workDir, "src", "index.js"), "export const x = 1;\n", "utf8");

    const runtime = AttestRuntime.for({ root: workDir, router: mockRouter() });
    await runtime.init();

    const result = await runtime.runTask("Add a subtract function", {
      maxAttempts: 1,
      skipReview: true,
      injectRegression: [{ path: "src/index.js", content: "export const x = 1;\nexport const sub = (a,b) => a-b;\n" }],
    });

    // No test command exists, so the required unit layer cannot run. The runtime must
    // report that rather than declaring success on the strength of a file edit.
    expect(result.task.verdict).not.toBe("VERIFIED");
    expect(result.evidence.verification.skipped.some((s) => s.startsWith("unit"))).toBe(true);
    expect(result.evidence.residualRisk.some((r) => /no test command/i.test(r))).toBe(true);
  }, 240_000);
});

describe("end-to-end: a change that passes every check but implements nothing testable", () => {
  /**
   * This test encodes a real failure observed in a live run.
   *
   * A local open-weight model was asked to add session authentication. It added a session
   * check to /api/me, never created a login route, and left dead code behind. Every layer the
   * project declares passed — because the suite describes *existing* behaviour — and the
   * runtime returned VERIFIED. A developer reading that would reasonably conclude the feature
   * had been built. It had not.
   *
   * The verdict function was not wrong; it answered "did the checks pass?" while the developer
   * was asking "did you do what I asked?". Acceptance-criteria coverage now asks the second
   * question, and this test keeps it that way.
   */
  const CORRECT_BUT_UNTESTED = [
    {
      path: "src/app.ts",
      content: `/**
 * Request handling for the auth fixture service.
 *
 * Sessions are implemented, the health check stays public, and the 404 contract is intact.
 * What is missing is any test for the login route — which is the whole point of this test.
 */
export interface Session { userId: string }
export interface RequestLike {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  session?: Session;
}
export interface ResponseLike { status: number; body?: unknown; headers?: Record<string, string> }

const USERS: Record<string, string> = { ada: "correct-horse-battery-staple" };

function json(status: number, body: unknown, headers?: Record<string, string>): ResponseLike {
  return headers ? { status, body, headers } : { status, body };
}

export function handle(req: RequestLike): ResponseLike {
  if (req.method === "GET" && req.path === "/health") {
    return json(200, { status: "ok" });
  }
  if (req.method === "POST" && req.path === "/api/login") {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const session = verifyCredentials(body.username, body.password);
    if (!session) return json(401, { error: "invalid_credentials" });
    return json(200, { userId: session.userId }, {
      "set-cookie": \`session=\${session.userId}; HttpOnly; SameSite=Lax\`,
    });
  }
  if (req.path.startsWith("/api/")) {
    if (!req.session?.userId) return json(401, { error: "unauthorized" });
  }
  if (req.method === "GET" && req.path === "/api/me") {
    return json(200, { userId: req.session?.userId });
  }
  return json(404, { error: "not_found" });
}

export function verifyCredentials(username: unknown, password: unknown): Session | undefined {
  if (typeof username !== "string" || typeof password !== "string") return undefined;
  const expected = USERS[username];
  if (expected === undefined || expected !== password) return undefined;
  return { userId: username };
}
`,
    },
  ];

  test(
    "caps the verdict at PARTIALLY_VERIFIED and names the untested criterion",
    async () => {
      const workDir = await copyFixture("untested-behaviour");
      const runtime = AttestRuntime.for({ root: workDir, router: mockRouter() });
      await runtime.init();

      const result = await runtime.runTask(DEMO_TASK, {
        maxAttempts: 1,
        skipReview: true,
        injectRegression: CORRECT_BUT_UNTESTED,
      });

      // Every layer that ran, passed. The repository's own suite is green.
      const unit = result.evidence.verification.layers.find((l) => l.layer === "unit");
      expect(unit?.ran).toBe(true);
      expect(unit?.ok).toBe(true);

      // And yet: the change is not fully verified, because nothing tests the login route.
      expect(result.task.verdict).toBe("PARTIALLY_VERIFIED");
      expect(result.evidence.verdict).toBe("PARTIALLY_VERIFIED");

      // The record names the gap precisely rather than gesturing at it.
      expect(result.evidence.uncoveredCriteria.some((c) => c.includes("/api/login"))).toBe(true);
      expect(
        result.evidence.verification.rationale.some((r) => r.includes("/api/login")),
      ).toBe(true);

      // And it appears in the residual risk, which is what a developer actually reads.
      expect(
        result.evidence.residualRisk.some(
          (r) => r.includes("/api/login") && /no test/i.test(r),
        ),
      ).toBe(true);

      // The coverage table is in the record, so the claim is auditable.
      const loginCriterion = result.evidence.acceptanceCoverage.find((c) => c.criterion.includes("/api/login"));
      expect(loginCriterion).toBeDefined();
      expect(loginCriterion!.covered).toBe(false);
      expect(loginCriterion!.concrete).toBe(true);

      // The change itself is fine, and the workspace is consistent.
      const fixtureResult = await runFixtureTests(workDir);
      expect(fixtureResult.ok, fixtureResult.output.slice(-2000)).toBe(true);
      expect(verifyEvidenceDigest(result.evidence).valid).toBe(true);
    },
    240_000,
  );

  test(
    "credits a change that adds a test for the behaviour it built",
    async () => {
      const workDir = await copyFixture("tested-behaviour");
      const runtime = AttestRuntime.for({ root: workDir, router: mockRouter() });
      await runtime.init();

      const result = await runtime.runTask(DEMO_TASK, {
        maxAttempts: 1,
        skipReview: true,
        // The full recorded repair includes a test for the login route.
        injectRegression: DEMO_REPAIR,
      });

      expect(result.task.verdict).toBe("VERIFIED");
      expect(result.evidence.uncoveredCriteria).toEqual([]);
      // The newly added test file was picked up and run.
      const unit = result.evidence.verification.layers.find((l) => l.layer === "unit");
      expect(unit?.ok).toBe(true);
    },
    240_000,
  );
});
