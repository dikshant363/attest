/**
 * The scripted demonstration scenario.
 *
 * READ THIS BEFORE JUDGING THE DEMO.
 *
 * The *first edit* and the *repair* in `attest demo` are recorded change sets, not live
 * model output. They are replayed so that the failure-and-recovery path is reproducible
 * on any machine, at any time, with or without a model installed. Without that, a live
 * demo of an autonomous recovery loop is a coin flip, and a coin flip is not evidence.
 *
 * What is NOT scripted — and this is the entire point:
 *   - the pre-flight baseline run against the repository's own tests
 *   - the checkpoint taken before the change
 *   - the execution of the change through the audited tool runtime
 *   - the multi-layer verification that detects the regression
 *   - the rollback, which restores the workspace and proves it with a tree hash
 *   - the re-verification after repair
 *   - the evidence record, its verdict, and its seal
 *
 * The naive change below is a *real* regression class: an authentication guard applied to
 * the entire request surface, so it executes before the public health route. That is one
 * of the most common ways a plausible-looking auth change takes down production. The
 * recorded repair is the correction a competent engineer would make.
 *
 * To see the live model path instead, run:
 *   attest task "Add session-based authentication, and make sure the platform health check keeps working."
 */

export const DEMO_TASK =
  "Add session-based authentication, and make sure the platform health check keeps working.";

/**
 * The recorded regression: authentication applied to every route.
 *
 * Note the ordering — the session guard runs before the `/health` route is matched, and
 * before route matching happens at all. This breaks two contracts the repository already
 * had: the platform health check, and the 404 for unknown routes.
 */
export const DEMO_REGRESSION = [
  {
    path: "src/app.ts",
    content: `/**
 * Request handling for the auth fixture service.
 *
 * CHANGE UNDER REVIEW: session-based authentication has been added.
 */

export interface Session {
  userId: string;
}

export interface RequestLike {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  session?: Session;
}

export interface ResponseLike {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** In-memory user store. Passwords are compared directly here because this is a fixture. */
const USERS: Record<string, string> = {
  ada: "correct-horse-battery-staple",
};

function json(status: number, body: unknown, headers?: Record<string, string>): ResponseLike {
  return headers ? { status, body, headers } : { status, body };
}

export function handle(req: RequestLike): ResponseLike {
  if (req.method === "POST" && req.path === "/api/login") {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const session = verifyCredentials(body.username, body.password);
    if (!session) {
      return json(401, { error: "invalid_credentials" });
    }
    return json(200, { userId: session.userId }, {
      "set-cookie": \`session=\${session.userId}; HttpOnly; SameSite=Lax\`,
    });
  }

  // Session authentication for the service.
  if (!req.session?.userId) {
    return json(401, { error: "unauthorized" });
  }

  if (req.method === "GET" && req.path === "/health") {
    return json(200, { status: "ok" });
  }

  if (req.method === "GET" && req.path === "/api/me") {
    return json(200, { userId: req.session.userId });
  }

  return json(404, { error: "not_found" });
}

export function verifyCredentials(username: unknown, password: unknown): Session | undefined {
  if (typeof username !== "string" || typeof password !== "string") return undefined;
  const expected = USERS[username];
  if (expected === undefined || expected !== password) return undefined;
  return { userId: username };
}
`,
  },
];

/**
 * The recorded repair: scope the guard to the API surface, and evaluate the login route
 * before it, so the public health check and the 404 contract both survive.
 */
export const DEMO_REPAIR = [
  {
    path: "src/middleware/requireAuth.ts",
    content: `import type { RequestLike, ResponseLike } from "../app.ts";

/**
 * Session authentication.
 *
 * Returns a 401 response when the caller has no session, or undefined to continue.
 * Callers decide the scope of this guard — that decision is the whole game.
 */
export function requireAuth(req: RequestLike): ResponseLike | undefined {
  if (!req.session?.userId) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  return undefined;
}
`,
  },
  {
    path: "src/app.ts",
    content: `/**
 * Request handling for the auth fixture service.
 *
 * Session-based authentication is applied to the /api/ surface only. The health check
 * and the login route must stay reachable without a session.
 */
import { requireAuth } from "./middleware/requireAuth.ts";

export interface Session {
  userId: string;
}

export interface RequestLike {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  session?: Session;
}

export interface ResponseLike {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** In-memory user store. Passwords are compared directly here because this is a fixture. */
const USERS: Record<string, string> = {
  ada: "correct-horse-battery-staple",
};

function json(status: number, body: unknown, headers?: Record<string, string>): ResponseLike {
  return headers ? { status, body, headers } : { status, body };
}

export function handle(req: RequestLike): ResponseLike {
  // The platform health check runs before any session exists, so it is matched first
  // and never passes through the guard.
  if (req.method === "GET" && req.path === "/health") {
    return json(200, { status: "ok" });
  }

  // Login must be reachable while unauthenticated, so it is handled before the guard.
  if (req.method === "POST" && req.path === "/api/login") {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const session = verifyCredentials(body.username, body.password);
    if (!session) {
      return json(401, { error: "invalid_credentials" });
    }
    return json(200, { userId: session.userId }, {
      "set-cookie": \`session=\${session.userId}; HttpOnly; SameSite=Lax\`,
    });
  }

  // The guard is scoped to the API surface. Everything else keeps its previous behaviour.
  if (req.path.startsWith("/api/")) {
    const unauthorized = requireAuth(req);
    if (unauthorized) return unauthorized;
  }

  if (req.method === "GET" && req.path === "/api/me") {
    return json(200, { userId: req.session?.userId });
  }

  return json(404, { error: "not_found" });
}

export function verifyCredentials(username: unknown, password: unknown): Session | undefined {
  if (typeof username !== "string" || typeof password !== "string") return undefined;
  const expected = USERS[username];
  if (expected === undefined || expected !== password) return undefined;
  return { userId: username };
}
`,
  },
];
