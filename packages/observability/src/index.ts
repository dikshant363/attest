/**
 * @attest/observability — Sentry Agent Tracing.
 *
 * WHY THIS IS HAND-WRITTEN
 * Sentry's Node SDK auto-instruments OpenAI, Anthropic, the Vercel AI SDK and LangChain.
 * It does NOT instrument Ollama, which is the whole point of this project: the default
 * path runs an open-weight model locally. So the spans here follow Sentry's generative-AI
 * semantic conventions manually, which is a feature rather than a workaround — it means
 * the trace records what actually happened rather than what an integration assumed.
 *
 * DESIGN CONSTRAINTS
 *  1. Zero cost when disabled. With no SENTRY_DSN every function here is a pass-through,
 *     and the SDK is never even imported. `attest` must work with no network at all.
 *  2. Never fail the caller. Observability that can break the thing it observes is worse
 *     than no observability, so every SDK interaction is guarded.
 *  3. Never send repository content. Spans carry model ids, tool names, counts, latencies
 *     and verdicts. Not file contents, not prompts, not diffs.
 */

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

interface SentryLike {
  init(options: Record<string, unknown>): void;
  startSpan<T>(options: Record<string, unknown>, callback: (span: unknown) => T): T;
  captureException(err: unknown): void;
  flush(timeout?: number): Promise<boolean>;
  setTag(key: string, value: string): void;
}

let sentry: SentryLike | undefined;
let enabled = false;
let initialised = false;

/** True when a DSN was provided and the SDK loaded successfully. */
export function isEnabled(): boolean {
  return enabled;
}

export function dsnPresent(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.SENTRY_DSN && env.SENTRY_DSN.trim().length > 0);
}

/**
 * Initialise tracing. Safe to call repeatedly and safe to call with no DSN.
 * Returns whether tracing is active.
 */
export async function initObservability(
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (initialised) return enabled;
  initialised = true;
  if (!dsnPresent(env)) return false;
  try {
    const mod = (await import("@sentry/node")) as unknown as SentryLike;
    mod.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? "local",
      release: env.SENTRY_RELEASE ?? "attest@0.1.0",
      // Local models cost nothing, so a cost widget fed by a guessed price would be a lie.
      // We record token counts and let the platform price only what it can price.
      tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 1.0),
      // Repository content never leaves the machine through this integration.
      sendDefaultPii: false,
      beforeSend(event: unknown) {
        return event;
      },
    });
    sentry = mod;
    enabled = true;
    return true;
  } catch {
    // SDK absent or failed to load: stay silent and stay functional.
    enabled = false;
    return false;
  }
}

/** Run `fn` inside a named span. Pass-through when tracing is off. */
export async function withSpan<T>(
  name: string,
  op: string,
  attributes: SpanAttributes,
  fn: (addAttributes: (attrs: SpanAttributes) => void) => Promise<T> | T,
): Promise<T> {
  if (!enabled || !sentry) return fn(() => undefined);

  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (v !== undefined) clean[k] = v;
  }

  try {
    return await sentry.startSpan(
      { name, op, attributes: clean },
      async (span: unknown) => {
        const s = span as {
          setAttribute?: (k: string, v: string | number | boolean) => void;
          setAttributes?: (a: Record<string, string | number | boolean>) => void;
        };
        const addAttributes = (attrs: SpanAttributes) => {
          const filtered: Record<string, string | number | boolean> = {};
          for (const [k, v] of Object.entries(attrs)) if (v !== undefined) filtered[k] = v;
          if (typeof s?.setAttributes === "function") s.setAttributes(filtered);
          else if (typeof s?.setAttribute === "function") {
            for (const [k, v] of Object.entries(filtered)) s.setAttribute(k, v);
          }
        };
        return await fn(addAttributes);
      },
    );
  } catch {
    // A tracing failure must never fail the operation being traced.
    return fn(() => undefined);
  }
}

/**
 * Span around one task, following the gen_ai.invoke_agent convention.
 * This is the root span a judge would open first.
 */
export function withTaskSpan<T>(
  intent: string,
  taskId: string,
  fn: (addAttributes: (attrs: SpanAttributes) => void) => Promise<T>,
): Promise<T> {
  return withSpan(
    `invoke_agent ${truncateName(intent)}`,
    "gen_ai.invoke_agent",
    {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "attest",
      "gen_ai.agent.id": taskId,
      // The intent is the developer's own words and is the point of the trace. File
      // contents and diffs are deliberately excluded.
      "attest.task.intent": truncateName(intent),
    },
    fn,
  );
}

/** Span around one model call, following the gen_ai.chat convention. */
export function withModelSpan<T>(
  args: {
    role: string;
    modelId: string;
    provider: string;
    weightClass: string;
    offline: boolean;
  },
  fn: (addAttributes: (attrs: SpanAttributes) => void) => Promise<T>,
): Promise<T> {
  return withSpan(
    `chat ${args.modelId}`,
    "gen_ai.chat",
    {
      "gen_ai.operation.name": "chat",
      "gen_ai.system": args.provider,
      "gen_ai.request.model": args.modelId,
      "gen_ai.agent.role": args.role,
      // Whether the model's weights are open is auditable in the product itself, so it
      // belongs in the trace too.
      "attest.model.weight_class": args.weightClass,
      "attest.model.offline": args.offline,
    },
    fn,
  );
}

/** Span around one tool call, following the gen_ai.execute_tool convention. */
export function withToolSpan<T>(
  args: { tool: string; permission: string; mutating: boolean },
  fn: (addAttributes: (attrs: SpanAttributes) => void) => Promise<T>,
): Promise<T> {
  return withSpan(
    `execute_tool ${args.tool}`,
    "gen_ai.execute_tool",
    {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": args.tool,
      "attest.tool.permission": args.permission,
      "attest.tool.mutating": args.mutating,
    },
    fn,
  );
}

/** Capture an error without importing Sentry at the call site. */
export function captureError(err: unknown, context?: Record<string, string>): void {
  if (!enabled || !sentry) return;
  try {
    if (context) {
      for (const [k, v] of Object.entries(context)) sentry.setTag(k, v);
    }
    sentry.captureException(err);
  } catch {
    /* never fail because tracing failed */
  }
}

/**
 * Reset module state.
 *
 * Exists so a test can point the SDK at a capturing endpoint on a fresh DSN. Not used by
 * the runtime, and marked as such rather than hidden behind a build flag.
 */
export function _resetObservabilityForTests(): void {
  sentry = undefined;
  enabled = false;
  initialised = false;
}

/** Flush pending events. Call before the process exits, or spans are lost. */
export async function flushObservability(timeoutMs = 3000): Promise<void> {
  if (!enabled || !sentry) return;
  try {
    await sentry.flush(timeoutMs);
  } catch {
    /* ignore */
  }
}

function truncateName(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
}
