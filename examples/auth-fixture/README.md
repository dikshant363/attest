# auth-fixture

A deliberately small but realistic HTTP service. It exists to be the **target repository**
for Attest's end-to-end demonstration, in the same way a real project would be.

## Why this fixture and not a toy

The interesting part of an autonomous coding demo is not that the agent can write code.
It is what happens when the code it writes breaks something. To make that reproducible and
honest, this fixture has:

1. **Real behaviour under test.** `GET /health` is public, `GET /api/me` requires a session,
   unknown routes 404. All of it runs over a real socket in the integration test.
2. **A constraint that is easy to violate.** Adding authentication is the classic way to
   accidentally lock out a health check. `attest.constraints.json` states this explicitly so
   the runtime hands the constraint to the planner and the implementer up front.
3. **A stable regression suite.** Every assertion passes both before and after a *correct*
   authentication change, so the suite is a genuine gate rather than a spec to be rewritten.

## Current state

Sessions are **not implemented**. `GET /api/me` returns 401 unconditionally as a stub, and
`POST /api/login` does not exist. The obvious next task is:

> Add session-based authentication, and make sure the platform health check keeps working.

The naive implementation — a global auth middleware applied to every route — makes
`GET /health` return 401 and breaks the suite. That is the failure Attest is built to catch,
roll back, diagnose and repair.

## Running it

```bash
npm test        # node:test suite (unit + real-HTTP integration)
npm run typecheck
npm start       # http://127.0.0.1:4321
```

Both scripts resolve `tsx` and `tsc` from the monorepo root, so no install is needed here.
