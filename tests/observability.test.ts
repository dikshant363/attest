/**
 * Sentry agent-tracing tests.
 *
 * These do not require a Sentry account. The SDK is pointed at a local HTTP server that
 * captures the envelopes it would have sent, so the assertions are about what this project
 * *emits* rather than about what Sentry does with it.
 *
 * That distinction is the point: the claim "Attest emits gen_ai spans" must be verifiable by
 * anyone who clones the repository, not only by someone holding a DSN.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  _resetObservabilityForTests,
  flushObservability,
  initObservability,
  isEnabled,
  withModelSpan,
  withSpan,
  withTaskSpan,
  withToolSpan,
} from "@attest/observability";

let server: http.Server;
let port: number;
const captured: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      captured.push(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("observability", () => {
  test("is inert when no DSN is configured", async () => {
    _resetObservabilityForTests();
    const active = await initObservability({});
    expect(active).toBe(false);
    expect(isEnabled()).toBe(false);

    // Every helper must still work as a pass-through: an unavailable tracing backend must
    // never break the operation being traced.
    const value = await withSpan("n", "op", {}, async () => 42);
    expect(value).toBe(42);
    expect(await withTaskSpan("intent", "task", async () => "ok")).toBe("ok");
    expect(await withModelSpan({ role: "r", modelId: "m", provider: "p", weightClass: "open-weight", offline: true }, async () => "ok")).toBe("ok");
    expect(await withToolSpan({ tool: "t", permission: "read", mutating: false }, async () => "ok")).toBe("ok");
  });

  test("emits gen_ai spans that a capturing endpoint receives", async () => {
    captured.length = 0;
    _resetObservabilityForTests();

    // The DSN points at the local capture server. Sentry's SDK derives the envelope URL from
    // the DSN, so this exercises the real transport rather than a stub.
    const active = await initObservability({
      SENTRY_DSN: `http://publickey@127.0.0.1:${port}/1`,
      SENTRY_ENVIRONMENT: "test",
      SENTRY_TRACES_SAMPLE_RATE: "1.0",
    });
    expect(active).toBe(true);

    await withTaskSpan("Add session-based authentication", "task_test", async (addTask) => {
      await withModelSpan(
        { role: "planner", modelId: "gemma4:e2b", provider: "ollama", weightClass: "open-weight", offline: true },
        async (addModel) => {
          addModel({
            "gen_ai.usage.input_tokens": 120,
            "gen_ai.usage.output_tokens": 40,
            "attest.model.latency_ms": 429,
            "attest.model.schema_valid": true,
          });
        },
      );
      await withToolSpan({ tool: "apply_edits", permission: "write", mutating: true }, async () => {
        /* the tool ran */
      });
      addTask({ "attest.verdict": "VERIFIED", "attest.failures.count": 1, "attest.rollbacks.count": 1 });
    });

    await flushObservability(5000);

    const body = captured.join("\n");
    expect(body.length).toBeGreaterThan(0);

    // The three span types, following the generative-AI semantic conventions.
    expect(body).toContain("gen_ai.invoke_agent");
    expect(body).toContain("gen_ai.chat");
    expect(body).toContain("gen_ai.execute_tool");

    // The attributes that make the trace answer the questions this project cares about.
    expect(body).toContain("gemma4:e2b");
    expect(body).toContain("ollama");
    expect(body).toContain("open-weight");
    expect(body).toContain("apply_edits");
    expect(body).toContain("VERIFIED");

    // And nothing that would leak the repository.
    expect(body).not.toContain("TODO: sessions are not implemented");
  });

  test("a failing trace never fails the traced operation", async () => {
    _resetObservabilityForTests();
    // A DSN pointing at a closed port: the transport will fail.
    await initObservability({ SENTRY_DSN: "http://key@127.0.0.1:9/1" });
    const value = await withSpan("n", "op", { "a.b": 1 }, async () => "survived");
    expect(value).toBe("survived");
  });
});
