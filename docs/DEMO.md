# DEMO.md

> What the demonstration shows, how to run it, and exactly what is real.

---

## 1. The story in one line

A developer asks for a feature. The agent writes something plausible. It breaks the platform's
health check. **Attest catches it, rolls back, works out why, fixes it, proves the fix, and hands
over a receipt.**

That is the product. Not "the agent wrote code" — that part is easy — but *the failure was caught
without the developer doing anything, and the recovery is provable*.

## 2. Run it

```bash
npm install                                     # once
ollama pull gemma4:e2b                          # once (3.5 GB, Apache-2.0)
node bin/attest.mjs init --dir examples/auth-fixture
node bin/attest.mjs demo --dir examples/auth-fixture
```

Then read the receipt:

```bash
node bin/attest.mjs evidence --markdown --diff
node bin/attest.mjs explain
node bin/attest.mjs verify
```

## 3. The target repository

`examples/auth-fixture` is a small, real HTTP service with a real regression suite: a pure request
handler, a live server, and five `node:test` tests that include a genuine HTTP round trip.

Its existing behaviour:

| Route | Behaviour |
|---|---|
| `GET /health` | 200, **no session required** — the platform health check depends on this |
| `GET /api/me` | 401 without a session |
| anything else | 404 |

It declares a constraint in `attest.constraints.json`:

> *GET /health must remain reachable without authentication, because the platform health check calls
> it before any session exists.*

The task is:

> **Add session-based authentication, and make sure the platform health check keeps working.**

The naive implementation — a session guard applied to the whole request surface — makes `/health`
return 401 and breaks the 404 contract. This is one of the most common ways a plausible-looking auth
change takes down production, which is why it is the demonstration.

## 4. What happens, step by step

```
▸ INTERPRET
  understood: add session authentication while keeping the health check reachable
  (acceptance criteria derived; ambiguities stated; the planner is handed the constraints)

▸ PLAN
  1. [edit] add session authentication scoped to the API surface  → src/app.ts
  2. [verify] run the project's test suite and type checker
  risks: the health check must stay public

▸ BASELINE
  baseline green: 5 passing        ← the repo's own tests, run before anything is touched

  ◆ checkpoint cp_…  (7 files captured)

▸ EXECUTE
  applied the authentication change

▸ VERIFY
  pass  security
  FAIL  unit                       ← the project's own tests catch it
  pass  typecheck

✗ FAILURE  test_assertion in unit
  | not ok 1 - GET /health is public and reports ok
  |   expected: 200
  |   actual:   401

▸ ROLLBACK
  ↩ rollback verified (7 restored, 0 removed)

▸ DIAGNOSE
  the authentication guard was applied to the whole request surface, so it ran before the
  public /health route and before route matching

▸ EXECUTE (REPAIR, ATTEMPT 2)
  edit  src/middleware/requireAuth.ts (create)
  edit  src/app.ts (modify)

▸ VERIFY
  pass  security
  pass  unit                       ← 5/5
  pass  typecheck

VERDICT  VERIFIED
  ✓ security: no findings in 2 changed file(s)
  ✓ unit: 5/5 passing
  ✓ typecheck: exited 0
  ✓ regression: baseline preserved (5 → 5 passing)
  not checked (not declared by this project): lint, build, e2e
```

## 5. The receipt

```
✅ VERIFIED  ev_…  task=task_…
  intent     : Add session-based authentication, and make sure the platform health check keeps working.
  files      : 2 changed
  models     : gemma4:e2b(open-weight)
  layers     : security=pass unit=pass typecheck=pass lint=skipped build=skipped e2e=skipped regression=pass
  failures   : 1
  rollbacks  : 1
  residual   : 4 item(s)
```

`attest evidence --markdown` renders the full record: the original intent, the interpretation
(labelled as an interpretation), the plan, every file change, every command with its exit code, the
tools and their permission levels, the models **with weight class**, real test counts, the failure
with its real assertion text, the diagnosis, the rollback with its verified tree hash, the
verification layers, the verdict reasons, and — importantly — **what you should still check
yourself**.

## 6. Full disclosure: what is scripted

Being precise about this matters more than the demo looking impressive.

### Scripted

- **The first edit.** A recorded change set replaces the implementer's output, so the
  failure-and-recovery path is reproducible on any machine at any time. Without this, a live demo of
  an autonomous recovery loop is a coin flip, and a coin flip is not evidence.
- **The repair.** Also a recorded change set, for the same reason.

These are replayed through the real `apply_edits` tool, and the loop labels them in its output and
in the evidence record: *"replaying a recorded repair — not model output."*

### Not scripted — the actual runtime

- Reading the repository, discovering its commands, and discovering its constraints
- The pre-flight baseline run against the repository's own tests
- The checkpoint before the change
- Executing the change through the audited tool runtime, with permission checks and path confinement
- **The multi-layer verification that detects the regression**, including running the project's real
  `node:test` suite over a real HTTP round trip
- **The rollback**, which restores the workspace and *proves it* by recomputing the tree hash
- Re-verification after the repair
- The verdict, computed by `computeVerdict()`
- The evidence record, its digest, and the audit trail
- Every model call in the interpret, plan and review steps

### To see the live model path

```bash
node bin/attest.mjs task "Add session-based authentication, and make sure the platform health check keeps working." \
  --dir examples/auth-fixture
```

Here the implementer is the real model, reading files through the tool runtime and producing its own
edits. The failure may or may not occur — that is what a live run means. **The recovery machinery
behaves identically either way**, which is the point: it is not a scripted sequence, it is the loop.

If the model produces a correct change on the first attempt, you get a clean `VERIFIED` with no
failures. If it produces the naive change, you get the full recovery. If it produces something
unfixable, you get `ROLLED_BACK` and a workspace that is byte-for-byte what you started with.

## 7. Proving the safety property

The most important behaviour is what happens when recovery *fails*. There is a test for it:

```bash
npx vitest run tests/end-to-end.test.ts
```

It runs the demo with a "repair" that reintroduces the same regression, and asserts:

- the verdict is `ROLLED_BACK`, not `VERIFIED`
- `src/app.ts` is **byte-for-byte identical** to the pristine file
- the created middleware file is gone
- the repository's own tests still pass — nothing was left broken
- the evidence record says, in `residualRisk`, that the change was rolled back and nothing applied

An agent that fails safely is more valuable than one that usually succeeds.

## 8. Reset between runs

The demo is idempotent — checkpoint rollback restores the state it started from, so it can be run
repeatedly. To return to the pristine fixture:

```bash
git checkout -- examples/auth-fixture/src
rm -rf examples/auth-fixture/src/middleware examples/auth-fixture/.attest
```

## 9. Recording script (for a screen recording)

| # | Narration | Command |
|---|---|---|
| 1 | "Here's a small service. Note the constraint in this file: the health check must stay public." | `cat examples/auth-fixture/attest.constraints.json` |
| 2 | "Attest reads the repo and builds its Project World — commands, tests, constraints, and what it does *not* know." | `attest init --dir examples/auth-fixture` |
| 3 | "Now a normal request." | `attest demo --dir examples/auth-fixture` |
| 4 | *(let it run — the failure and rollback narrate themselves)* | |
| 5 | "It failed, rolled back, diagnosed, fixed, and re-verified. Here's the receipt." | `attest evidence --markdown` |
| 6 | "Every number here was observed. And it tells me what it did *not* check." | scroll the layers table |
| 7 | "The seal is real." | `attest verify` |
| 8 | "Try to fake it." | edit the JSON by hand, re-run `attest verify` → seal breaks |
| 9 | "And I can undo any of it." | `attest rollback --task <id>` |
| 10 | "This ran entirely on my laptop, on an open-weight model, with no API key." | `attest models` |

Step 8 is the one that lands. Editing `verdict` to `VERIFIED` and watching the seal break is a
30-second demonstration that this is not a chat transcript dressed up as a report.

## 10. Non-graphical proof

For a judge who would rather run one command than watch a video:

```bash
npm run selftest        # typecheck + lint + 83 tests, including four end-to-end proofs
```
