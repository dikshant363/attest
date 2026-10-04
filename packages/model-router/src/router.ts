import type {
  ModelDescriptor,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelRun,
} from "@attest/shared";
import { nowIso, newId, sha256 } from "@attest/shared";
import { withModelSpan } from "@attest/observability";
import { loadRouterConfig, type RouterConfig } from "./config.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import { OpenAICompatProvider } from "./providers/openai-compat.ts";
import { MockProvider } from "./providers/mock.ts";

/** Measured, machine-specific capability data. Replaces the static priors once observed. */
export interface ProbeResult {
  modelId: string;
  provider: string;
  reachable: boolean;
  latencyMs?: number;
  jsonCompliant?: boolean;
  toolCalling?: boolean;
  error?: string;
  probedAt: string;
}

export interface SelectionOptions {
  /** Never pick a model from these providers. Used to keep the reviewer independent. */
  excludeProviders?: string[];
  /** Never pick these exact models (e.g. the one that authored the change under review). */
  excludeModels?: string[];
}

/**
 * Per-role preference weights. Kept explicit so routing is reviewable, not vibes.
 *
 * `minCodeStrength` is a HARD filter, so it is used sparingly. It would be easy to set
 * "repairer requires 0.55" and feel rigorous, but that silently excludes every small local
 * model from the repair step — which would mean the runtime quietly stops working offline
 * exactly when it matters most. Repair instead prefers a stronger model through the
 * difficulty weighting below, while keeping weak models eligible.
 */
interface RoleProfile {
  needsStructured: boolean;
  minCodeStrength: number;
  preferOffline: boolean;
  /** Higher = the router is willing to escalate to a costlier, stronger model. */
  escalateOnDifficulty: number;
}

const ROLE_PROFILES: Record<string, RoleProfile> = {
  planner: { needsStructured: true, minCodeStrength: 0.0, preferOffline: true, escalateOnDifficulty: 0.7 },
  diagnoser: { needsStructured: true, minCodeStrength: 0.0, preferOffline: true, escalateOnDifficulty: 0.6 },
  // Note the 0.0: a 2B local model must remain eligible to repair, or the offline path dies.
  repairer: { needsStructured: true, minCodeStrength: 0.0, preferOffline: true, escalateOnDifficulty: 0.5 },
  reviewer: { needsStructured: true, minCodeStrength: 0.0, preferOffline: false, escalateOnDifficulty: 0.4 },
  interpreter: { needsStructured: true, minCodeStrength: 0.0, preferOffline: true, escalateOnDifficulty: 0.5 },
  summarizer: { needsStructured: false, minCodeStrength: 0.0, preferOffline: true, escalateOnDifficulty: 0.9 },
};

const DEFAULT_PROFILE: RoleProfile = {
  needsStructured: true,
  minCodeStrength: 0,
  preferOffline: true,
  escalateOnDifficulty: 0.6,
};

/**
 * ModelRouter — provider-agnostic, open-weight-first.
 *
 * Selection order is deterministic and explainable:
 *   1. hard filters   (proprietary policy, offline policy, capability, exclusions)
 *   2. availability   (is the provider reachable)
 *   3. fit score      (capability, privacy, cost, measured latency)
 *   4. fallback chain (every remaining candidate, best first)
 *
 * Nothing is hard-coded to one vendor, and every choice is recorded as a ModelRun.
 */
export class ModelRouter {
  private providers: ModelProvider[] = [];
  private descriptors: ModelDescriptor[] = [];
  private probes = new Map<string, ProbeResult>();
  private refreshed = false;

  /** Optional sink so the runtime can persist a ModelRun for every call. */
  onRun?: (run: ModelRun) => void;
  /** Optional trace hook so the runtime can stream "which model is thinking". */
  onSelect?: (role: string, chosen: ModelDescriptor, considered: ModelDescriptor[]) => void;

  constructor(readonly config: RouterConfig = loadRouterConfig()) {
    this.buildProviders();
  }

  private buildProviders(): void {
    const { ollamaUrl, timeoutMs, gatewayUrl, allowGateway } = this.config;
    this.providers = [new OllamaProvider(ollamaUrl, timeoutMs)];
    if (allowGateway) {
      this.providers.push(new OpenAICompatProvider("gateway", gatewayUrl, timeoutMs));
    }
  }

  /** Register an extra provider (used by tests, and by future MCP-hosted model servers). */
  registerProvider(p: ModelProvider): void {
    this.providers.push(p);
    this.refreshed = false;
  }

  /** Register a deterministic provider. Tests rely on this to prove the loop without a model. */
  useMockProvider(mock: MockProvider): void {
    this.providers = [mock];
    this.refreshed = false;
  }

  getProviders(): ModelProvider[] {
    return this.providers;
  }

  /** Discover models across all providers. Cheap enough to call per command. */
  async refresh(): Promise<ModelDescriptor[]> {
    const found: ModelDescriptor[] = [];
    for (const p of this.providers) {
      try {
        found.push(...(await p.listModels()));
      } catch {
        /* an unreachable provider is not an error; it is simply not a candidate */
      }
    }
    this.descriptors = this.applyPolicy(found);
    this.refreshed = true;
    return this.descriptors;
  }

  /** Apply the open-weight / offline / gateway policy to a raw descriptor list. */
  private applyPolicy(models: ModelDescriptor[]): ModelDescriptor[] {
    return models.filter((m) => {
      if (!this.config.allowProprietary && m.weightClass === "proprietary") return false;
      if (this.config.offlineOnly && !m.capabilities.offline) return false;
      if (m.provider === "gateway" && !this.config.allowGateway) return false;
      return true;
    });
  }

  /**
   * Apply the policy to a single descriptor the caller obtained elsewhere.
   * Exposed so the CLI can explain *why* a model was rejected.
   */
  isAllowed(m: ModelDescriptor): { allowed: boolean; reason?: string } {
    if (!this.config.allowProprietary && m.weightClass === "proprietary") {
      return {
        allowed: false,
        reason: `proprietary weights are refused (set ATTEST_ALLOW_PROPRIETARY=1 to opt in)`,
      };
    }
    if (this.config.offlineOnly && !m.capabilities.offline) {
      return { allowed: false, reason: "offline-only mode is active" };
    }
    if (m.provider === "gateway" && !this.config.allowGateway) {
      return { allowed: false, reason: "hosted gateway is disabled" };
    }
    return { allowed: true };
  }

  private async ensure(): Promise<void> {
    if (!this.refreshed) await this.refresh();
  }

  /**
   * Rank candidate models for a request. Deterministic given the same world state.
   */
  async selectCandidates(req: ModelRequest, opts: SelectionOptions = {}): Promise<ModelDescriptor[]> {
    await this.ensure();
    const profile = ROLE_PROFILES[req.role] ?? DEFAULT_PROFILE;
    const difficulty = req.difficulty ?? "medium";
    const exclP = new Set(opts.excludeProviders ?? []);
    const exclM = new Set(opts.excludeModels ?? []);

    const candidates = this.descriptors.filter((m) => {
      if (exclP.has(m.provider) || exclM.has(m.id)) return false;
      if (profile.needsStructured && !m.capabilities.structuredOutput) return false;
      if (m.capabilities.codeStrength < profile.minCodeStrength) return false;
      return true;
    });

    const withAvailability = await Promise.all(
      candidates.map(async (m) => ({ m, up: await this.providerAvailable(m.provider) })),
    );

    const scored = withAvailability
      .filter((c) => c.up)
      .map(({ m }) => ({ m, score: this.score(m, profile, req, difficulty) }))
      .sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id));

    // Guarantee at least one candidate when everything is down but a model exists:
    // a hard failure with a clear message beats a mysterious empty list.
    if (scored.length === 0 && candidates.length > 0) {
      return candidates;
    }
    return scored.map((s) => s.m);
  }

  private score(
    m: ModelDescriptor,
    profile: RoleProfile,
    req: ModelRequest,
    difficulty: "low" | "medium" | "high",
  ): number {
    let s = 0;
    // Privacy: a privacy-sensitive task must not leave the machine.
    if (req.privacySensitive) s += m.capabilities.offline ? 100 : -100;
    // Default bias toward local: free, fast enough, private.
    if (profile.preferOffline) s += m.capabilities.offline ? 20 : 0;
    // Capability fit.
    s += m.capabilities.codeStrength * 30;
    // Escalation: only reach for the strong/costly model when the task is genuinely hard.
    const wantsStrong = difficulty === "high";
    s += wantsStrong ? m.capabilities.codeStrength * 40 : 0;
    // Cost sensitivity: on easy tasks, prefer the cheap model decisively.
    s -= m.costTier * (wantsStrong ? 4 : 14);
    // Measured latency beats a guessed one.
    const probe = this.probes.get(`${m.provider}:${m.id}`);
    if (probe?.latencyMs !== undefined) s -= Math.min(probe.latencyMs, 60_000) / 4_000;
    // Tool calling is required for the agent loop to act.
    if (m.capabilities.toolCalling) s += 3;
    return s;
  }

  private availabilityCache = new Map<string, boolean>();

  private async providerAvailable(name: string): Promise<boolean> {
    const cached = this.availabilityCache.get(name);
    if (cached !== undefined) return cached;
    const p = this.providers.find((x) => x.name === name);
    const up = p ? await p.available() : false;
    this.availabilityCache.set(name, up);
    return up;
  }

  /** Clear the availability cache. Call between top-level commands. */
  resetAvailability(): void {
    this.availabilityCache.clear();
  }

  /**
   * Complete a request, walking the ranked fallback chain.
   * Every attempt is reported through `onRun`, including the failures — a fallback
   * that is invisible in the evidence record would be a form of dishonesty.
   */
  async complete<T = unknown>(
    req: ModelRequest,
    opts: SelectionOptions = {},
  ): Promise<ModelResponse<T>> {
    const chain = await this.selectCandidates(req, opts);
    if (chain.length === 0) {
      throw new Error(
        `no model available for role "${req.role}". ` +
          `Start a local model (ollama serve) or enable the gateway. ` +
          `Run: attest models`,
      );
    }

    const considered = chain;
    const errors: string[] = [];
    let fellBackFrom: string | undefined;

    for (const descriptor of chain) {
      const provider = this.providers.find((p) => p.name === descriptor.provider);
      if (!provider) continue;
      const started = Date.now();
      try {
        const res = (await withModelSpan(
          {
            role: req.role,
            modelId: descriptor.id,
            provider: descriptor.provider,
            weightClass: descriptor.weightClass,
            offline: descriptor.capabilities.offline,
          },
          async (addAttributes) => {
            const response = (await provider.complete(req, descriptor.id)) as ModelResponse<T>;
            addAttributes({
              "gen_ai.usage.input_tokens": response.promptTokens,
              "gen_ai.usage.output_tokens": response.completionTokens,
              "attest.model.latency_ms": response.latencyMs,
              "attest.model.schema_valid": response.schemaValid,
              "attest.model.fell_back_from": response.fellBackFrom,
            });
            return response;
          },
        )) as ModelResponse<T>;
        const model = res.model;
        this.onSelect?.(req.role, descriptor, considered);
        this.record({
          role: req.role,
          model,
          promptDigest: sha256(req.system + "\n" + req.prompt).slice(0, 16),
          latencyMs: res.latencyMs,
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
          schemaValid: res.schemaValid,
          fellBackFrom,
          startedAt: new Date(started).toISOString(),
        });
        return fellBackFrom ? { ...res, fellBackFrom } : res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${descriptor.provider}:${descriptor.id} → ${message}`);
        this.record({
          role: req.role,
          model: {
            modelId: descriptor.id,
            provider: descriptor.provider,
            weightClass: descriptor.weightClass,
          },
          promptDigest: sha256(req.system + "\n" + req.prompt).slice(0, 16),
          latencyMs: Date.now() - started,
          schemaValid: false,
          error: message,
          startedAt: new Date(started).toISOString(),
        });
        fellBackFrom ??= `${descriptor.provider}:${descriptor.id}`;
      }
    }

    throw new Error(`all models failed for role "${req.role}":\n  ${errors.join("\n  ")}`);
  }

  private record(
    run: Omit<ModelRun, "id" | "taskId" | "executionId"> & { taskId?: string; executionId?: string },
  ): void {
    if (!this.onRun) return;
    this.onRun({ id: newId("run"), ...run } as ModelRun);
  }

  /**
   * Measure what a model can actually do on this machine, instead of trusting a
   * leaderboard. Records latency, JSON compliance and tool-call support.
   */
  async probe(modelId?: string, providerName?: string): Promise<ProbeResult[]> {
    await this.ensure();
    const targets = this.descriptors.filter(
      (m) => (!modelId || m.id === modelId) && (!providerName || m.provider === providerName),
    );
    const results: ProbeResult[] = [];

    for (const m of targets) {
      const provider = this.providers.find((p) => p.name === m.provider);
      if (!provider) continue;
      const started = Date.now();
      const result: ProbeResult = {
        modelId: m.id,
        provider: m.provider,
        reachable: false,
        probedAt: nowIso(),
      };
      try {
        const res = (await provider.complete(
          {
            role: "probe",
            system:
              "You are a capability probe. Reply with JSON only. No prose, no markdown fences.",
            prompt: 'Return exactly this JSON object and nothing else: {"ok": true}',
            schema: { type: "object" },
            maxTokens: 64,
            temperature: 0,
          },
          m.id,
        )) as ModelResponse<{ ok: boolean }>;
        result.reachable = true;
        result.latencyMs = Date.now() - started;
        result.jsonCompliant = res.schemaValid && res.parsed !== undefined;
        // Tool calling is not asserted from a static table: it is reported only when
        // we can observe a tool-capable response. Until then it stays undefined.
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
      }
      this.probes.set(`${m.provider}:${m.id}`, result);
      results.push(result);
    }
    return results;
  }

  getProbes(): ProbeResult[] {
    return [...this.probes.values()];
  }

  /** Human-readable explanation of the routing decision, for `attest models why`. */
  async explain(req: ModelRequest, opts: SelectionOptions = {}): Promise<string> {
    const chain = await this.selectCandidates(req, opts);
    const lines: string[] = [];
    lines.push(`role: ${req.role}   difficulty: ${req.difficulty ?? "medium"}`);
    lines.push(`policy: open-weight-only=${!this.config.allowProprietary}  offline-only=${this.config.offlineOnly}`);
    if (chain.length === 0) {
      lines.push("no candidates");
      return lines.join("\n");
    }
    lines.push(`chosen: ${chain[0]!.provider}:${chain[0]!.id}`);
    lines.push("fallback chain:");
    for (const [i, m] of chain.entries()) {
      lines.push(
        `  ${i + 1}. ${m.provider}:${m.id}  weights=${m.weightClass}  ` +
          `code=${m.capabilities.codeStrength}  cost=${m.costTier}`,
      );
    }
    return lines.join("\n");
  }
}

export function createDefaultRouter(env?: Record<string, string | undefined>): ModelRouter {
  return new ModelRouter(loadRouterConfig(env));
}
