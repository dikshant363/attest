import type {
  ModelDescriptor,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "@attest/shared";
import { extractJson } from "@attest/shared";
import { localModelDescriptor } from "../config.ts";

interface OllamaTagsResponse {
  models?: { name?: string; model?: string; size?: number; details?: { parameter_size?: string } }[];
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string; tool_calls?: unknown[] };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Local open-weight inference over the Ollama HTTP API.
 *
 * This is the default path for every task. It requires no API key, no network,
 * and keeps the repository contents on the developer's machine.
 */
export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const body = (await res.json()) as OllamaTagsResponse;
      return (body.models ?? [])
        .map((m) => m.name ?? m.model)
        .filter((n): n is string => Boolean(n))
        .map((n) => localModelDescriptor(n, this.name));
    } catch {
      return [];
    }
  }

  async complete<T = unknown>(req: ModelRequest, modelId: string): Promise<ModelResponse<T>> {
    const started = Date.now();
    const wantsJson = Boolean(req.schema) || /json/i.test(req.role);
    const body: Record<string, unknown> = {
      model: modelId,
      stream: false,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      options: {
        temperature: req.temperature ?? 0.1,
        num_predict: req.maxTokens ?? 2048,
      },
    };
    if (wantsJson) body.format = "json";

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as OllamaChatResponse;
    if (json.error) throw new Error(`ollama: ${json.error}`);
    const text = json.message?.content ?? "";
    const latencyMs = Date.now() - started;

    let parsed: T | undefined;
    let schemaValid = true;
    if (req.schema) {
      const extracted = extractJson(text);
      parsed = extracted as T | undefined;
      schemaValid = extracted !== undefined;
    }

    return {
      text,
      parsed,
      model: { modelId, provider: this.name, weightClass: "open-weight" },
      latencyMs,
      promptTokens: json.prompt_eval_count,
      completionTokens: json.eval_count,
      schemaValid,
    };
  }
}
