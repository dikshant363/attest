# PROBLEM_STATEMENT.md

> The problem, stated precisely, with the evidence that it is real.

---

## The one-sentence version

**Developers who delegate work to AI coding agents do not stop working — they become the manual
verification and coordination layer for their own tools.**

## Who this is about

A college-student / indie developer — call them **{{FRIEND}}** — who builds full-stack and AI
projects alone and uses AI coding agents daily.

They are not a beginner. They are not confused about how to use an agent. They are exactly the
person current tooling is built for, and they are still doing the boring part by hand.

Their toolchain is an agent, a terminal, GitHub, documentation, a browser, a test runner, and two or
three different models. They are the integration layer between all of it.

## The scenario, concretely

{{FRIEND}} asks an agent:

> "Add authentication to this application."

The agent produces an implementation in seconds. Then {{FRIEND}} has to answer ten questions the
agent did not:

1. Did it understand the existing architecture?
2. Did it modify the right files?
3. Did it preserve existing behaviour?
4. Did it introduce a security problem?
5. Do the tests actually cover the requirement?
6. What else broke?
7. If something failed, what caused it?
8. Can it be repaired, or do I start over?
9. What exactly changed, and why?
10. **Can I trust the result?**

The agent said "Done" after step zero. Every one of those ten questions is {{FRIEND}}'s problem.

## Why current tools don't solve it

This is not a claim that existing agents are bad. They are good at the thing they were built for —
producing changes — and that thing is not the bottleneck.

| What is missing | Why the current shape of the tools cannot provide it |
|---|---|
| **Persistent cross-tool project context** | Agent context is per-session; a memory file is advisory, and a new tool starts empty. The developer re-explains the architecture every time. |
| **Justified confidence** | The agent's report of success is a *claim*. Nothing distinguishes "the model believes it worked" from "it was executed and observed to work". |
| **Cheap reversal** | Git can revert, but only if the developer noticed, and only if they know which of forty changed files to revert. Recovery is manual and late. |
| **An auditable answer to "what happened"** | A chat transcript is not an audit trail. It does not say which commands ran, what they returned, or which model produced which edit. |
| **Enforced verification** | Checks run if the developer runs them. There is no gate that says: this change does not get accepted until these things passed. |
| **Calibratable trust** | The developer has no way to know what was *not* checked, so they either re-verify everything or trust blindly. Both are bad. |

The result: **the developer is the orchestration layer**, and the faster the agent writes code, the
more verification work it generates.

That is the paradox worth naming. Making code generation faster does not reduce the developer's
total work if verification remains manual — it *shifts* the work downstream and increases the volume
of unverified change.

## What "solved" looks like

The developer states an engineering goal and supervises:

```
intent → understand → plan → execute → test → fail safely → recover → verify → explain
```

Concretely:

- The agent knows the project without being told again, and knows what it does not know.
- Nothing is modified without a reversible checkpoint.
- Verification is *executed*, layered, and reported honestly, including what did not run.
- Failure is detected by the project's own tests, not by the developer noticing.
- Bad changes are rolled back automatically and the rollback is proven.
- The result comes with evidence that can be checked, and a verdict the model did not write.
- The developer's remaining job is to decide, not to coordinate.

## Falsifiable claims

A problem statement that cannot be wrong is marketing. These are the claims this project makes, and
each one has a test:

| Claim | How to falsify it |
|---|---|
| A bad change is caught without a human | `tests/end-to-end.test.ts` — the fixture's own suite catches the regression |
| A failed attempt leaves the workspace untouched | The same file asserts byte-for-byte equality after an unrecoverable failure |
| A verdict cannot come from a model | `computeVerdict` is pure; `RUN: grep -r "verdict =" packages/ --include=*.ts` shows the single assignment site |
| Open-source AI is load-bearing, not decorative | The router refuses non-open-weight models by default; `tests/router.test.ts` asserts the refusal |
| An evidence record cannot be edited undetected | `attest verify` recomputes the digest; editing the JSON breaks the seal |

## Scope: what this problem is not

- **Not** "AI cannot write code". It can, and that is not the issue.
- **Not** "developers need a better chat interface". The interface is not the bottleneck.
- **Not** a claim that agents should be fully autonomous. Irreversible actions must stay with a
  human, and Attest refuses them by design.
- **Not** "one agent to rule them all". The problem is not the number of agents.

## The narrow version we built

The full problem is broad. The hackathon build solves one workflow extremely well — *a single
developer with a repository, a test suite, and a task* — and is architected so the rest can follow:
the Project World, tool runtime, verification engine and evidence system are all independent of the
CLI that drives them.

See `DECISION.md` for why that scoping choice was made, and `ARCHITECTURE.md` for how the
generalisation is structured.
