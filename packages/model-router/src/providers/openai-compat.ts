import type {
  ModelDescriptor,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "@attest/shared";
import { extractJson } from "@attest/shared";
import { gatewayModelDescriptor } from "../config.ts";

interface OpenAIModelsResponse {
  data?: { id?: string }[];
}

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Any OpenAI-compatible endpoint. Used here for the local gateway that serves the
 * open-weight gpt-oss-120b model, and usable unchanged for other hosted providers.
 * Weight class is decided by model name in `gatewayModelDescriptor`, not asserted here.
 */
export class OpenAICompatProvider implements ModelProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly apiKey?: string,
  ) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as OpenAIModelsResponse;
      return (body.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => Boolean(id))
        .map((id) => gatewayModelDescriptor(id, this.name));
    } catch {
      return [];
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async complete<T = unknown>(req: ModelRequest, modelId: string): Promise<ModelResponse<T>> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: modelId,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      temperature: req.temperature ?? 0.1,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.schema) body.response_format = { type: "json_object" };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${this.name} ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as OpenAIChatResponse;
    if (json.error?.message) throw new Error(`${this.name}: ${json.error.message}`);
    const text = json.choices?.[0]?.message?.content ?? "";
    const latencyMs = Date.now() - started;

    let parsed: T | undefined;
    let schemaValid = true;
    if (req.schema) {
      const extracted = extractJson(text);
      parsed = extracted as T | undefined;
      schemaValid = extracted !== undefined;
    }

    const descriptor = gatewayModelDescriptor(modelId, this.name);
    return {
      text,
      parsed,
      model: { modelId, provider: this.name, weightClass: descriptor.weightClass },
      latencyMs,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
      schemaValid,
    };
  }
}
