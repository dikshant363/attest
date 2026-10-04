# TESTING.md

> What is tested, at which level, and what the tests are actually for.

---

## The philosophy

Tests here exist to defend **claims**, not to raise a coverage number. Every test in this repository
can be traced to one of five properties the project asserts:

1. An autonomous run cannot escape the project root.
2. An autonomous run cannot perform a destructive action without explicit human approval.
3. A failed attempt leaves the workspace exactly as it was found.
4. A verdict is never produced by a model, and never claims more than the evidence supports.
5. An evidence record cannot be modified after it is sealed without detection.

A test that does not defend one of those, or that guards real behaviour against regression, does not
belong. Coverage is not a goal; calibratable trust is.

## Running

```bash
npm test            # vitest: 67 tests across 3 files
npm run typecheck   # tsc --noEmit, strict
npm run lint        # project conventions + the injection-notice rule
npm run selftest    # all three, in order
```

## Layout

| File | Level | What it proves |
|---|---|---|
| `tests/unit.test.ts` | unit | Path safety, command policy, the permission model, checkpoint/restore, output parsing, the security scan, `computeVerdict`, evidence sealing, diffing, CLI parsing, repository analysis |
| `tests/router.test.ts` | unit | The open-weight refusal, offline mode, candidate ranking, fallback recording, probe honesty |
| `tests/end-to-end.test.ts` | end-to-end | The whole loop against a real repository with a real `node:test` suite |

## The tests that matter most

### `tests/end-to-end.test.ts` → *detects the regression, rolls back with proof, repairs, re-verifies, and seals evidence*

Runs the complete loop against the real fixture: interprets, plans, runs the baseline, checkpoints,
applies a change that breaks the health check, **runs the project's own test suite as a real
subprocess**, detects the failure, rolls back, repairs, re-verifies, and seals evidence.

It asserts the *substance*, not just the exit code:

```ts
expect(evidence.failures[0].classification).toBe("test_assertion");
expect(evidence.failures[0].signal).toMatch(/not ok|health|expected/i);  // real assertion text
expect(evidence.rollbacks.every((r) => r.ok)).toBe(true);                // rollback was verified
expect(evidence.modelsUsed.every((m) => m.weightClass === "open-weight")).toBe(true);
expect(verifyEvidenceDigest(evidence).valid).toBe(true);                 // seal intact
const finalApp = await readFile("src/app.ts");
expect(finalApp).toContain('req.path.startsWith("/api/")');              // the fix is actually there
const fixtureResult = await runFixtureTests(workDir);
expect(fixtureResult.ok).toBe(true);                                     // and it really passes
```

### → *when the repair also fails, the workspace is left at the known-good state*

This is the test that matters most for safety. The "repair" reintroduces the same regression, and the
test asserts:

```ts
expect(result.task.verdict).toBe("ROLLED_BACK");           // not VERIFIED
const after = await readFile("src/app.ts");
expect(after).toBe(pristine);                              // byte-for-byte identical
await expect(access("src/middleware")).rejects.toThrow();  // the new file is gone
expect(fixtureResult.ok).toBe(true);                       // nothing left broken
```

An agent that fails safely is worth more than one that usually succeeds.

### `tests/unit.test.ts` → *a required layer that never ran yields UNVERIFIED*

The anti-overclaiming rule, stated as a test:

```ts
const v = computeVerdict([layer("security", true), layer("unit", false, /* ran */ false)]);
expect(v.verdict).toBe("UNVERIFIED");   // absence of evidence is not evidence
```

### → *destructive tools need explicit approval*

```ts
await expect(rt.invoke("delete_file", { path: "a.txt" }, { allowWrite: true })).rejects.toThrow(/destructive/);
expect(await fs.readdir(tmp)).toEqual(["a.txt"]);   // refusing is not advisory
```

### → *apply_edits validates the whole batch before writing anything*

A batch containing one valid edit and one impossible edit must leave the disk untouched. Atomicity is
asserted, not assumed.

### → *fails loudly when no model is reachable*

When nothing can serve the request, the error names the role and the remedies. A silent empty
candidate list would be the worst possible failure — it would look like "nothing to do".

## How the tests avoid model flakiness

The end-to-end tests use a `MockProvider` for the interpreter and planner turns, and recorded change
sets for the edit and repair turns. **Nothing else is mocked.** The checkpoints, the subprocess test
runs, the output parsing, the rollback verification, the verdict computation and the evidence sealing
are the genuine implementations.

This is a deliberate trade-off. A test that depends on a stochastic model is a test that fails for
reasons unrelated to the code, and a flaky safety test gets muted — which is worse than not having it.
The deterministic path exercises exactly the machinery that must be correct; the model's contribution
is what varies in production, and its *contract* is tested separately via schema validation, retry,
and the router tests.

The live model path is exercised by the CLI itself (`attest demo`, `attest task`).

## What is not tested

- **Live model quality.** Whether a 2B model writes a good auth middleware is not a property of this
  codebase, and a test asserting it would be both flaky and meaningless. The *contract* around the
  model — schema validation, retry on malformed output, fallback on failure — is tested.
- **Next.js rendering.** The web app is a read-only view over the same data the CLI tests cover.
- **The macOS-specific things** (`AirPlay` on port 5000, `brew services`). Environment, not code.

## The one thing to run if you only run one thing

```bash
npx vitest run tests/end-to-end.test.ts
```

Four tests, about six seconds, and they demonstrate the entire thesis: detect, roll back with proof,
repair, verify, seal — and fail safely when repair is impossible.

## Writing a new verification layer

If you add a layer, `computeVerdict()` needs to know whether it is required. The rule to preserve:
**an optional layer that did not run must be reported as skipped, and must never be counted as
passing.** Add a test for both the pass and the skip case, or the layer will quietly become a way to
claim success without evidence.
