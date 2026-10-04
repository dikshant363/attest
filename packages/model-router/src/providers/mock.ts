import type {
  ModelDescriptor,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "@attest/shared";

export type MockResponder = (req: ModelRequest, modelId: string) => string;

/**
 * Deterministic provider for tests and for `--dry-run` demos.
 *
 * It is a first-class citizen of the router on purpose: the runtime's control flow
 * (checkpoint → execute → verify → diagnose → rollback → repair) must be provable
 * without depending on a stochastic model. If the loop only works when the model
 * behaves, the loop is not engineered — it is hoped for.
 */
export class MockProvider implements ModelProvider {
  readonly name = "mock";
  private responses: MockResponder[] = [];

  constructor(private readonly models: string[] = ["mock-planner", "mock-repairer"]) {}

  /** Queue responders; they are consumed in order, last one repeats. */
  queue(...responders: MockResponder[]): this {
    this.responses = responders;
    return this;
  }

  async available(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return this.models.map((id) => ({
      id,
      provider: this.name,
      weightClass: "open-weight" as const,
      capabilities: {
        toolCalling: true,
        structuredOutput: true,
        contextWindow: 32_000,
        codeStrength: 0.5,
        offline: true,
      },
      costTier: 0,
    }));
  }

  async complete<T = unknown>(req: ModelRequest, modelId: string): Promise<ModelResponse<T>> {
    const started = Date.now();
    const idx = Math.min(this.calls, this.responses.length - 1);
    this.calls++;
    const responder = this.responses[idx];
    const text = responder ? responder(req, modelId) : "{}";
    let parsed: T | undefined;
    let schemaValid = true;
    if (req.schema) {
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        schemaValid = false;
      }
    }
    return {
      text,
      parsed,
      model: { modelId, provider: this.name, weightClass: "open-weight" },
      latencyMs: Date.now() - started,
      schemaValid,
    };
  }

  private calls = 0;
}
