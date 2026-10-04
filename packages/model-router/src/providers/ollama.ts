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
  message?: { role?: string; content?: string; thinking?: string; tool_calls?: unknown[] };
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
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
    /** Send `think: false`. See RouterConfig.ollamaDisableThinking for why. */
    private readonly disableThinking = true,
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

    const buildBody = (thinking: boolean): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model: modelId,
        stream: false,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        options: {
          temperature: req.temperature ?? 0.1,
          // Floor of 1024: a reasoning model can burn a small budget on its trace and
          // return empty content, which would look like a malformed answer rather than
          // a truncated one.
          num_predict: Math.max(req.maxTokens ?? 2048, 1024),
        },
      };
      if (wantsJson) body.format = "json";
      if (!thinking) body.think = false;
      return body;
    };

    let res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody(!this.disableThinking)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    // A model or Ollama build without thinking support may reject the `think` parameter.
    // Fall back rather than failing the whole task over an optimisation.
    if (!res.ok && this.disableThinking) {
      const text = await res.text().catch(() => "");
      if (/think/i.test(text)) {
        res = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildBody(true)),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } else {
        throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as OllamaChatResponse;
    if (json.error) throw new Error(`ollama: ${json.error}`);

    let text = json.message?.content ?? "";
    const thinking = json.message?.thinking ?? "";
    // If the answer is empty but a reasoning trace exists, the budget was consumed by the
    // trace. Say so explicitly instead of returning "" and letting the caller guess.
    if (text.trim() === "" && thinking.trim() !== "") {
      throw new Error(
        `ollama returned an empty answer from ${modelId}: the token budget was consumed by a ` +
          `reasoning trace (${thinking.length} chars). Thinking is disabled by default; ` +
          `pass ATTEST_OLLAMA_THINKING=1 only with a much larger maxTokens.`,
      );
    }
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
