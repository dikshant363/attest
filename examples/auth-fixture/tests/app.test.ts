/**
 * The auth fixture's regression suite.
 *
 * These tests describe behaviour that already exists and must keep existing. They are
 * the signal Attest uses to decide whether an autonomous change is safe to keep.
 *
 * Note that every assertion here is stable across the intended change (adding sessions):
 * the correct implementation keeps `/health` public and keeps `/api/me` returning 401
 * when there is no session. That is why these tests are a valid regression gate rather
 * than a spec that has to be rewritten.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { handle } from "../src/app.ts";

describe("unit: request handling", () => {
  test("GET /health is public and reports ok", () => {
    const res = handle({ method: "GET", path: "/health", headers: {} });
    assert.equal(res.status, 200, "the platform health check must not require a session");
    assert.deepEqual(res.body, { status: "ok" });
  });

  test("GET /health is public even when no session header is present", () => {
    const res = handle({ method: "GET", path: "/health", headers: { cookie: "" } });
    assert.equal(res.status, 200);
  });

  test("GET /api/me returns 401 without a session", () => {
    const res = handle({ method: "GET", path: "/api/me", headers: {} });
    assert.equal(res.status, 401);
  });

  test("an unknown route returns 404", () => {
    const res = handle({ method: "GET", path: "/definitely-not-a-route", headers: {} });
    assert.equal(res.status, 404);
  });
});

describe("integration: over real HTTP", () => {
  test("the server serves /health without credentials", async () => {
    // A live server proves the wiring, not just the pure function.
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PORT: "4399" },
      stdio: "ignore",
    });
    try {
      await waitForPort(4399, 15_000);
      const body = await get("http://127.0.0.1:4399/health");
      assert.equal(body.status, 200);
      assert.deepEqual(body.json, { status: "ok" });
    } finally {
      child.kill("SIGTERM");
    }
  });
});

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await get(`http://127.0.0.1:${port}/health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`server on port ${port} did not start in time`);
}

function get(url: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        let json: unknown;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}
