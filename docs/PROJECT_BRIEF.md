# PROJECT_BRIEF.md

> One page: what this is, who it is for, and what "done" means.

---

## Identity

| | |
|---|---|
| **Name** | Attest |
| **Tagline** | An autonomous engineering runtime that will not say "done". It says *verified*, or it rolls back and tells you why. |
| **Built for** | Aarav — a second-year CS student and solo developer who builds full-stack and AI projects alone |
| **Context** | Hacktoberfest 2026 Weekend Challenge, theme *"Build for a Friend"* |
| **Licence** | Apache-2.0 |
| **Repository** | https://github.com/dikshant363/attest |

## The problem, in one paragraph

Developers who delegate work to AI coding agents do not stop working — they become the manual
verification and coordination layer for their own tools. The agent's "Done" is a claim, not
evidence, so the developer still runs the tests, reads the diff, finds what broke, works out why,
and reverses it by hand. Making code generation faster does not fix this; it increases the volume of
unverified change and shifts the work downstream.

## The thesis

> Treat an engineering task as a **transaction**: checkpoint, mutate, evaluate, commit or revert, and
> leave a receipt.

## Who it is for

A solo developer with a real repository and a real test suite who is already using AI agents and is
tired of being their integration layer.

Deliberately **not** "all developers". The runtime is architected to generalise, but every
prioritisation decision optimises for this one workflow. See `DECISION.md` ADR-001.

## What it does

```
intent → understand → plan → baseline → checkpoint → execute → verify
                                              │
                                    ┌─── fails ───┐
                                    ↓             │
                                rollback → diagnose → repair
                                    │                 │
                                    └──── re-verify ───┘
                                              │
                                          evidence
```

| Capability | What it means |
|---|---|
| **Persistent Project World** | Stack, commands, test files, constraints, decisions, unknowns — so no agent starts from scratch |
| **Checkpointed execution** | Nothing mutates outside a checkpoint; rollback is verified by tree hash |
| **Multi-layer verification** | 7 layers, executed, with a pre-flight baseline |
| **Computed verdicts** | A pure function over executed results. A model never writes the verdict. |
| **Enforced rollback** | A failed attempt is rolled back *before* it is repaired |
| **Sealed evidence** | A digest-protected record of intent, interpretation, plan, changes, commands, tools, models, tests, failures, repairs, rollbacks and residual risk |
| **Open-weight-first AI** | The router refuses non-open-weight models by default |

## Definition of done

All must be true:

- [x] A developer can point Attest at a repository and get a usable Project World
- [x] A natural-language task produces a plan, a real change, and a verdict
- [x] A change that breaks the project's own tests is **detected without human involvement**
- [x] The workspace is rolled back to a **provably** known-good state
- [x] The failure is diagnosed from its real output, and a repair is attempted
- [x] If repair also fails, the workspace is left **byte-for-byte** as found and the verdict says so
- [x] Every task ends with a sealed evidence record, including failures
- [x] The evidence record cannot be edited undetected
- [x] The default path runs an open-weight model locally, with no API key
- [x] A human can pause, inspect, and roll back at any point
- [x] `npm run selftest` passes: typecheck, lint, 67 tests

## What is explicitly out of scope

Desktop app, mobile, MCP server, external-agent delegation, Temporal durability, vector memory,
fine-tuning, multi-agent choreography, hosted control plane.

Each was considered and cut with a recorded reason. See `DECISIONS.md` ADR-008 and `TASKS.md`.

## Quality bar

The project optimises for, in order:

1. **Reliability** — the loop works, or it fails safely and says so
2. **Honesty** — no claim that is not backed by an executed observation
3. **Reversibility** — bad autonomous actions can be undone, and the undo is proven
4. **Explainability** — a developer can reconstruct what happened and why
5. **Open-source AI as a genuine component** — enforced by the router, tested
6. **Developer experience** — supervision instead of coordination

Features rank below all six.

## The one thing to look at

`tests/end-to-end.test.ts` → *when the repair also fails, the workspace is left at the known-good
state*. Four assertions, and they are the product.
