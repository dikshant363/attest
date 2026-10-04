/**
 * Request handling for the auth fixture service.
 *
 * Written as a pure function over a small request/response shape so the behaviour is
 * cheap to test and easy for a reader (or an agent) to reason about.
 *
 * Current state: there is no session support yet. `/api/me` responds 401 as a stub.
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

export function handle(req: RequestLike): ResponseLike {
  // The platform's health check calls this route before it knows anything about the
  // caller, so it must never require a session.
  if (req.method === "GET" && req.path === "/health") {
    return { status: 200, body: { status: "ok" } };
  }

  // TODO: sessions are not implemented yet. This always reports unauthorized.
  if (req.method === "GET" && req.path === "/api/me") {
    return { status: 401, body: { error: "unauthorized" } };
  }

  return { status: 404, body: { error: "not_found" } };
}

export function verifyCredentials(username: unknown, password: unknown): Session | undefined {
  if (typeof username !== "string" || typeof password !== "string") return undefined;
  const expected = USERS[username];
  if (expected === undefined || expected !== password) return undefined;
  return { userId: username };
}
