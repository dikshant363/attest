import type { ModelDescriptor } from "@attest/shared";

export interface RouterConfig {
  /** OpenAI-compatible gateway base URL, without trailing slash. */
  gatewayUrl: string;
  /** Preferred open-weight model on the gateway. */
  gatewayModel: string;
  ollamaUrl: string;
  /** Preferred local model tag. */
  ollamaModel: string;
  /** Secondary local model, used when the primary is unavailable. */
  ollamaFallbackModel: string;
  /** When true, only offline/local providers may be used. Guarantees zero egress. */
  offlineOnly: boolean;
  /** Hard ceiling on a single model call. */
  timeoutMs: number;
  /** Set false to disable the hosted gateway entirely. */
  allowGateway: boolean;
  /**
   * When false (the default), models whose weights are not open are refused by the
   * router. This is what makes "open-source AI is core, not decoration" an enforced
   * property of the runtime rather than a claim in a README.
   */
  allowProprietary: boolean;
}

type Env = Record<string, string | undefined>;

export function loadRouterConfig(env: Env = process.env): RouterConfig {
  const offline = env.ATTEST_OFFLINE === "1" || env.ATTEST_OFFLINE === "true";
  return {
    gatewayUrl: (env.ATTEST_GATEWAY_URL ?? "http://127.0.0.1:8787/v1").replace(/\/+$/, ""),
    gatewayModel: env.ATTEST_GATEWAY_MODEL ?? "gpt-oss-120b-medium",
    ollamaUrl: (env.ATTEST_OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, ""),
    ollamaModel: env.ATTEST_OLLAMA_MODEL ?? "gemma4:e2b",
    ollamaFallbackModel: env.ATTEST_OLLAMA_FALLBACK_MODEL ?? "gemma3:4b",
    offlineOnly: offline,
    timeoutMs: Number(env.ATTEST_MODEL_TIMEOUT_MS ?? 180_000),
    allowGateway: !offline && env.ATTEST_DISABLE_GATEWAY !== "1",
    allowProprietary:
      env.ATTEST_ALLOW_PROPRIETARY === "1" || env.ATTEST_ALLOW_PROPRIETARY === "true",
  };
}

/**
 * Static capability priors. These are *priors*: `attest models probe` replaces them with
 * measurements taken on this machine. We never claim a capability we have not observed.
 */
export function localModelDescriptor(id: string, provider = "ollama"): ModelDescriptor {
  const isCoder = /coder|code|deepseek|qwen/i.test(id);
  const isGemma = /gemma/i.test(id);
  const sizeB = guessParamBillions(id);
  return {
    id,
    provider,
    weightClass: "open-weight",
    capabilities: {
      // Open-weight models vary wildly; we start conservative and let the probe promote them.
      toolCalling: isCoder || isGemma,
      structuredOutput: true,
      contextWindow: isGemma ? 8192 : 32768,
      codeStrength: isCoder ? 0.7 : sizeB >= 7 ? 0.6 : 0.45,
      offline: true,
    },
    costTier: 0,
  };
}

export function gatewayModelDescriptor(id: string, provider = "gateway"): ModelDescriptor {
  // The gateway currently serves both open-weight (gpt-oss) and proprietary models.
  // We classify honestly by name so evidence records cannot overstate openness.
  const openWeight = /gpt-oss|llama|qwen|gemma|mistral|deepseek|mixtral|phi/i.test(id);
  const isSmall = /gpt-oss|flash-low|mini/i.test(id);
  return {
    id,
    provider,
    weightClass: openWeight ? "open-weight" : "proprietary",
    capabilities: {
      toolCalling: true,
      structuredOutput: true,
      contextWindow: 128_000,
      codeStrength: isSmall ? 0.72 : 0.85,
      offline: false,
    },
    costTier: openWeight ? 1 : 3,
  };
}

export function guessParamBillions(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)\s*b/i);
  if (m?.[1]) return Number(m[1]);
  return 4;
}
