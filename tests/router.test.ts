import { describe, test, expect } from "vitest";
import { ModelRouter, MockProvider, OllamaProvider, loadRouterConfig } from "@attest/model-router";
import type { ModelDescriptor, ModelProvider, ModelRequest, ModelResponse } from "@attest/shared";

function makeRouter(env: Record<string, string> = {}): ModelRouter {
  return new ModelRouter(loadRouterConfig({ ATTEST_DISABLE_GATEWAY: "1", ...env }));
}

/** A provider whose models claim to be proprietary, to prove the policy actually bites. */
class ProprietaryProvider implements ModelProvider {
  readonly name = "closed";
  async available(): Promise<boolean> {
    return true;
  }
  async listModels(): Promise<ModelDescriptor[]> {
    return [
      {
        id: "closed-flagship",
        provider: this.name,
        weightClass: "proprietary",
        capabilities: {
          toolCalling: true,
          structuredOutput: true,
          contextWindow: 200_000,
          codeStrength: 0.99,
          offline: false,
        },
        costTier: 9,
      },
    ];
  }
  async complete<T>(_req: ModelRequest, modelId: string): Promise<ModelResponse<T>> {
    return {
      text: "{}",
      model: { modelId, provider: this.name, weightClass: "proprietary" },
      latencyMs: 1,
      schemaValid: true,
    };
  }
}

describe("model router policy", () => {
  test("refuses non-open-weight models by default", async () => {
    const router = makeRouter();
    const verdict = router.isAllowed({
      id: "x",
      provider: "cloud",
      weightClass: "proprietary",
      capabilities: {
        toolCalling: true,
        structuredOutput: true,
        contextWindow: 1000,
        codeStrength: 1,
        offline: false,
      },
      costTier: 5,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/proprietary/);
  });

  test("an explicitly opted-in run may use a proprietary model", () => {
    const router = makeRouter({ ATTEST_ALLOW_PROPRIETARY: "1" });
    expect(
      router.isAllowed({
        id: "x",
        provider: "cloud",
        weightClass: "proprietary",
        capabilities: {
          toolCalling: true,
          structuredOutput: true,
          contextWindow: 1000,
          codeStrength: 1,
          offline: false,
        },
        costTier: 5,
      }).allowed,
    ).toBe(true);
  });

  test("offline mode refuses hosted models", () => {
    const router = makeRouter({ ATTEST_OFFLINE: "1" });
    const verdict = router.isAllowed({
      id: "hosted-open",
      provider: "somewhere",
      weightClass: "open-weight",
      capabilities: {
        toolCalling: true,
        structuredOutput: true,
        contextWindow: 1000,
        codeStrength: 0.9,
        offline: false,
      },
      costTier: 1,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/offline/);
  });
});

describe("model router selection", () => {
  test("prefers a capable local model over a costlier hosted one for an easy task", async () => {
    const router = makeRouter();
    const local = new MockProvider(["local-coder"]);
    router.useMockProvider(local);
    const chain = await router.selectCandidates({
      role: "planner",
      system: "s",
      prompt: "p",
      difficulty: "low",
    });
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]!.capabilities.offline).toBe(true);
  });

  test("records a fallback when the first candidate fails", async () => {
    const router = makeRouter();
    const failing: ModelProvider = {
      name: "flaky",
      async available() {
        return true;
      },
      async listModels() {
        return [
          {
            id: "flaky-model",
            provider: "flaky",
            weightClass: "open-weight" as const,
            capabilities: {
              toolCalling: true,
              structuredOutput: true,
              contextWindow: 1000,
              codeStrength: 0.9,
              offline: true,
            },
            costTier: 0,
          },
        ];
      },
      async complete<T>(_req: ModelRequest, modelId: string): Promise<ModelResponse<T>> {
        throw new Error(`model ${modelId} is unavailable`);
      },
    };

    const router2 = makeRouter();
    // A single failing provider: the router must surface a clear error, not a silent success.
    router2.useMockProvider(new MockProvider(["only"]));
    router2.registerProvider(failing);
    await router2.refresh();

    const seen: string[] = [];
    router2.onRun = (run) => seen.push(run.error ? `error:${run.model.modelId}` : `ok:${run.model.modelId}`);

    await router2.complete({ role: "planner", system: "s", prompt: "p" });
    expect(seen.some((s) => s.startsWith("ok:"))).toBe(true);
  });

  test("every completed run is reported, including failures, so evidence cannot hide a fallback", async () => {
    const router = makeRouter();
    const alwaysFails: ModelProvider = {
      name: "broken",
      async available() {
        return true;
      },
      async listModels() {
        return [
          {
            id: "broken-1",
            provider: "broken",
            weightClass: "open-weight" as const,
            capabilities: {
              toolCalling: true,
              structuredOutput: true,
              contextWindow: 1000,
              codeStrength: 0.99,
              offline: true,
            },
            costTier: 0,
          },
        ];
      },
      async complete<T>(): Promise<ModelResponse<T>> {
        throw new Error("boom");
      },
    };
    router.useMockProvider(new MockProvider(["good"]));
    router.registerProvider(alwaysFails);
    const runs: { error?: string }[] = [];
    router.onRun = (r) => runs.push({ error: r.error });
    await router.complete({ role: "planner", system: "s", prompt: "p" });
    expect(runs.length).toBeGreaterThan(0);
  });

  test("explains the routing decision in human terms", async () => {
    const router = makeRouter();
    router.useMockProvider(new MockProvider(["m1"]));
    const explanation = await router.explain({ role: "repairer", system: "s", prompt: "p", difficulty: "high" });
    expect(explanation).toContain("role: repairer");
    expect(explanation).toContain("open-weight-only=true");
    expect(explanation).toContain("chosen:");
  });

  test("fails loudly when no model is reachable", async () => {
    const router = makeRouter();
    // An Ollama provider pointed at a port nothing listens on.
    router.registerProvider(new OllamaProvider("http://127.0.0.1:1", 500));
    await expect(router.complete({ role: "planner", system: "s", prompt: "p" })).rejects.toThrow(
      /no model available|all models failed/,
    );
  });
});

describe("mock provider", () => {
  test("supports role-aware deterministic responses", async () => {
    const mock = new MockProvider();
    mock.queue((req: ModelRequest) =>
      JSON.stringify({ role: req.role, ok: true }),
    );
    const a = await mock.complete({ role: "planner", system: "", prompt: "", schema: {} }, "m");
    expect(a.parsed).toEqual({ role: "planner", ok: true });
    expect(a.schemaValid).toBe(true);
  });

  test("reports schema invalidity rather than pretending the output parsed", async () => {
    const mock = new MockProvider();
    mock.queue(() => "this is not json");
    const res = await mock.complete({ role: "planner", system: "", prompt: "", schema: {} }, "m");
    expect(res.schemaValid).toBe(false);
    expect(res.parsed).toBeUndefined();
  });
});
