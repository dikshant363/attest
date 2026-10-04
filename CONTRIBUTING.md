# CONTRIBUTING.md

> How to work on Attest, and the invariants that must not be broken.

---

## Getting set up

```bash
git clone <repo> && cd attest
npm install
ollama pull gemma4:e2b          # or any open-weight model; set ATTEST_OLLAMA_MODEL

npm run selftest                # typecheck + lint + 67 tests
node bin/attest.mjs init --dir examples/auth-fixture
node bin/attest.mjs demo --dir examples/auth-fixture
```

Requires Node ≥ 20.11. No API keys, no accounts, no network.

## The five invariants

These are not style preferences. If a change breaks one, the change is wrong regardless of how well
it works otherwise.

1. **No mutation happens outside a checkpoint.** Any new code path that writes to the workspace must
   run after `CheckpointManager.create()`. If you add a mutating tool, it must be reachable only from
   inside the loop's attempt body.

2. **A verdict comes only from `computeVerdict()`.** Never let a model produce, upgrade, or influence
   a verdict. Model review output is an *additional* signal that can only add residual risk — it can
   never turn `UNVERIFIED` into `VERIFIED`.

3. **A failed attempt is rolled back before it is repaired.** The repair prompt is built from a
   restored workspace. Do not diagnose a broken tree.

4. **Absence of evidence is never success.** If a required verification layer could not run, the
   verdict must be `UNVERIFIED`. Do not add a layer that defaults to "pass" when it cannot execute.

5. **Open-source AI stays load-bearing.** The router refuses non-open-weight models by default.
   Removing or weakening that default requires an ADR in `docs/DECISIONS.md`.

## Adding a verification layer

1. Add the layer name to `VerificationLayer` in `packages/shared/src/types.ts`.
2. Implement it in `packages/verification/src/engine.ts`.
3. Decide, explicitly, whether it is **required** or **optional**. Required means the task cannot be
   `VERIFIED` without it.
4. If it cannot run, it must report `ran: false` with a human-readable summary — never `ok: true`.
5. Add tests for **both** the pass case and the skip case. A layer without a skip test will quietly
   become a way to claim success without evidence.

A layer that shells out to an external tool should degrade honestly when the tool is missing, and say
so in `verification.skipped`.

## Adding a tool

1. Define it in `packages/tool-runtime/src/tools/`.
2. Give it a **zod input schema**, a **permission level**, and a **timeout**.
3. Choose the permission honestly:
   - `read` — no writes, no processes
   - `execute` — spawns processes
   - `write` — modifies the workspace
   - `dangerous` — destructive or irreversible
4. Route every path through `resolveInsideRoot`, or `assertWritableInsideRoot` if it writes.
5. If it mutates, return the `FileMutationResult` shape so `ToolRuntime` can normalise it into a
   `FileChange` for the evidence record. A mutation that does not produce a `FileChange` is invisible
   to the evidence system, which makes it a bug.
6. Add a test proving the permission gate actually refuses, **and** that the refusal left the disk
   untouched.

Never add a tool that bypasses the registry. The registry is the security boundary.

## Adding a model provider

Implement `ModelProvider` and register it with `router.registerProvider()`. Classify its models'
`weightClass` **honestly** — the evidence record reports it, and overstating openness would make the
whole record untrustworthy. If you add a provider whose weights are not open, it stays refused unless
the user opts in.

## Code conventions

- TypeScript, ESM, strict mode. `noUncheckedIndexedAccess` is on — handle the `undefined`.
- Relative imports carry the `.ts` extension (Node requires it; the lint rule enforces it).
- Library code does not print. Return data or emit an event; the CLI owns stdout.
- Library code does not call `process.exit`. Throw; the CLI decides.
- Prefer a small pure function over a method with hidden state. `computeVerdict` is the model.
- Comments explain **why**, not what. If a choice looks odd, the comment should say what went wrong
  the last time it was made differently.

## Before opening a pull request

```bash
npm run selftest
```

This runs, in order: `tsc --noEmit`, the project lint, and the test suite. All three must pass.

Then confirm the demo still works:

```bash
git checkout -- examples/auth-fixture/src
rm -rf examples/auth-fixture/src/middleware examples/auth-fixture/.attest
node bin/attest.mjs init --dir examples/auth-fixture
node bin/attest.mjs demo --dir examples/auth-fixture
```

The expected verdict is `VERIFIED`, with exactly one failure and one verified rollback in the
evidence record.

## Changing a decision

Architecture decisions live in `docs/DECISIONS.md`. To change one, add a **new** ADR that supersedes
it and says what was learned — do not edit the old entry. The record of a wrong decision, and why it
looked right at the time, is the most useful documentation in this repository.

## Honesty rules

These matter more than code style, because the product's value *is* its trustworthiness.

- **Never claim a technology is used when it is not.** If Temporal is designed for but not shipped,
  `TASKS.md` says exactly that.
- **Never make the demo look better than it is.** If part of it is scripted, say which part, in the
  output, in the docs, and in the evidence record.
- **Label model output as model output.** Interpretations and hypotheses carry provenance. Do not
  merge them into executed fact.
- **Record limitations.** `README.md` §Honest limitations, `SECURITY.md` §What Attest is NOT, and
  `DECISIONS.md` are all expected to grow.

## Licensing

Contributions are accepted under Apache-2.0. Do not paste code from a project whose licence is not
compatible. If you reuse something, add it to `THIRD_PARTY_NOTICES.md` with its licence and a link —
including the projects you evaluated and rejected, because that record is how the next person avoids
repeating the audit.
