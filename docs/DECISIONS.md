# DECISIONS.md

> Architecture decision log. Every entry records what was decided, what was rejected, and why —
> including the decisions that turned out to be wrong.

Format: **Decision · Context · Alternatives · Chosen · Why · Trade-off**

---

## ADR-001 — Anchor the product to one developer, not "developers"

**Context.** The brief asked for an autonomous engineering runtime. The Hacktoberfest Weekend
Challenge theme is *"Build for a Friend"*: build something with open-source AI at its core that
solves a real problem for one specific person.

**Alternatives.** (a) Build the runtime as a generic platform. (b) Pivot to a smaller, warmer
product for a non-developer. (c) Keep the runtime, but optimise every decision for one real
developer.

**Chosen.** (c).

**Why.** (a) fails the theme outright — and the theme is one of five judging criteria, while generic
positioning is also the most crowded space in AI tooling. (b) abandons the technical thesis. The
thesis and the theme are reconcilable *only* if there is a real person whose real problem is "I have
become the manual verification layer". There is, and that is the friend.

**Trade-off.** Some generality is lost. Accepted: a tool that solves one workflow excellently is
more useful than one that gestures at all of them.

---

## ADR-002 — The verdict is a pure function, never model output

**Context.** The single most dangerous failure mode is an agent that reports success on broken code.
A user who trusts a wrong `VERIFIED` is worse off than a user with no tool at all.

**Alternatives.** (a) Ask the model to judge its own work. (b) Ask a second model (LLM-as-judge).
(c) Compute the verdict from executed check results.

**Chosen.** (c), with model review only as an *additional* signal that can never upgrade a verdict.

**Why.** (a) is the failure mode. (b) is better but still a generated claim — a judge model can be
fooled by a plausible diff, and it cannot run the tests. Only executed checks produce evidence.

**Trade-off.** Verification is bounded by what the project can execute. A repository with no tests
cannot be verified — and Attest says so rather than papering over it. This is a feature: it makes
the tool's confidence calibratable.

**Consequence.** `computeVerdict()` takes no model, no clock, and no I/O. Same inputs, same verdict.

---

## ADR-003 — Refuse non-open-weight models by default

**Context.** "Open-source AI at its core" is a judging criterion, and it is trivially easy to satisfy
on paper while quietly escalating every hard step to a closed frontier model.

**Alternatives.** (a) Prefer open models, allow closed ones. (b) Document an open-first policy.
(c) Refuse closed weights unless explicitly opted in.

**Chosen.** (c). `ATTEST_ALLOW_PROPRIETARY=1` is required to change it.

**Why.** A policy that is a default can silently erode; a policy that is a refusal is testable.
There is a test asserting the refusal. It also produces better engineering: the constraint forces the
question "can a small local model actually do this?" instead of hand-waving it to a frontier API.

**Trade-off.** Hard reasoning steps get a weaker model than they could. Accepted — and partly
mitigated by permitting *hosted open-weight* models (gpt-oss) as an escalation path, which are still
open weights.

---

## ADR-004 — Snapshot checkpoints instead of `git stash` / `git reset --hard`

**Context.** Reversibility is the product's safety promise. The obvious implementation is git.

**Alternatives.** (a) `git stash` / `git reset --hard`. (b) A shadow git repository. (c) A private
file snapshot under `.attest/`.

**Chosen.** (c).

**Why.** (a) operates on the developer's **real** git state. An autonomous `reset --hard` can destroy
work that was never committed — the precise catastrophe the product exists to prevent. A runtime that
can silently destroy the last known-good state has failed at its only promise. (b) works but adds a
second git state machine to debug. (c) is a file operation the runtime fully controls, works in a
non-git directory, and never touches the developer's branch, index or stash.

**Trade-off.** Disk proportional to source size, and ignored trees (`node_modules`, `dist`) are
outside the snapshot, so they are neither captured nor deleted. Bounded by 3,000 files / 1.5 MB per
file.

**Consequence.** Rollback success is *proven*: after restoring, the tree hash is recomputed and
compared to the checkpoint's.

---

## ADR-005 — Roll back *before* diagnosing, not after

**Context.** When an attempt fails, there are two options: repair on top of the broken state, or
restore first and repair against known-good.

**Alternatives.** (a) Diagnose the current (broken) tree, then patch it. (b) Restore, then diagnose
and re-apply a corrected change.

**Chosen.** (b).

**Why.** (a) invites compounding errors: the model reasons about a tree that contains its own
mistake, and a second mistake stacks on the first. (b) gives the model a clean, understandable
baseline and makes the rollback a *demonstrated* part of the loop rather than an incidental one.

**Trade-off.** The repair must re-produce the whole change rather than a small delta, which asks more
of a small model. Accepted: correctness of the recovered state matters more than the size of the
patch.

---

## ADR-006 — One JSON document, not a database

**Context.** The world needs persistence. Postgres, Mongo, SQLite and a plain file were all
considered.

**Alternatives.** (a) PostgreSQL (the brief's default). (b) SQLite. (c) MongoDB Atlas. (d) A single
atomically-written JSON document plus an append-only log.

**Chosen.** (d).

**Why.** For a single-developer local tool, a database adds a connection to fail, a migration to run,
and a daemon to start — in exchange for query capability this workload does not use. The world is
bounded, and being human-inspectable with `cat` is a genuine advantage for a tool whose entire value
is *auditability*. Atomic write (temp file + rename) prevents corruption on a crash.

**Trade-off.** No concurrent writers; the whole document is rewritten on save. `WorldStore` is the
seam: swapping in SQLite or Postgres changes one class, not the runtime.

**Revisit when:** the world exceeds a few megabytes, or more than one process needs to write.

---

## ADR-007 — Exact-string edits instead of unified diffs from the model

**Context.** A model must express file changes. The standard format is a unified diff.

**Alternatives.** (a) Unified diff, applied by a patch parser. (b) Whole-file replacement. (c) Unique
exact-string `search`/`replace`, with whole-file writes for new files.

**Chosen.** (c), with (b) available.

**Why.** Small open-weight models produce reliable search/replace far more often than syntactically
valid diffs, and a malformed diff is an all-or-nothing failure. Search/replace also fails *informatively*:
zero matches means the snippet is stale, multiple matches means it needs more context. Both are errors
with a clear cause, never a silent guess.

**Trade-off.** The model must reproduce the search text exactly, which costs tokens. Mitigated by the
tool returning a precise error so a retry can correct it.

**Consequence.** `apply_edits` validates every edit in a batch before writing any of them, so a
partially applicable batch is rejected whole.

---

## ADR-008 — Cut Temporal, MCP server, and the desktop app

**Context.** Roughly 13 hours of build window. Durable execution (Temporal), an MCP server, and a
Tauri desktop shell were all considered.

**Alternatives.** (a) Build all three shallowly. (b) Build one deeply. (c) Build none, and document
the design.

**Chosen.** (c) for Temporal and desktop; (c) for the MCP server.

**Why.** An unfinished durable-workflow integration is worth less than a completed
checkpoint-and-rollback guarantee, because the theme of this build is *provable* safety rather than
surface area. A half-wired MCP server would have made the tool-safety story **weaker**, not stronger:
it would be a new path that bypasses the permission model. The tool registry is already the right
shape for MCP, so the seam exists.

**Trade-off.** Less impressive surface area. Accepted deliberately; the anti-bloat rule in the brief
said to cut P2 first, and this is that cut made explicitly rather than by running out of time.

---

## ADR-009 — A pre-flight baseline before any mutation

**Context.** When tests fail after a change, did the agent break something, or was the repository
already red?

**Alternatives.** (a) Assume the repository was green. (b) Run the baseline first.

**Chosen.** (b).

**Why.** Without a baseline, the runtime cannot distinguish "I broke it" from "it was broken", and a
`VERIFIED` on an already-failing repository is a lie. The baseline costs one test run and converts an
assumption into an observation.

**Trade-off.** Roughly one extra test run per task. Trivially worth it.

**Consequence.** If the baseline is red, the residual risk explicitly states that pass/fail on this
change is not conclusive.

---

## ADR-010 — Security scanning in-process, scoped to the change

**Context.** A security layer was wanted, but external scanners can be missing, slow, or noisy.

**Alternatives.** (a) Shell out to `npm audit` / Semgrep / Trivy. (b) An in-process rule set.
(c) Skip security entirely.

**Chosen.** (b), with the scanner scoped to files the task changed.

**Why.** A verification layer that can be "unavailable" is a layer that can silently stop protecting
the developer. In-process rules always run. Scoping to the change matters just as much: reporting
pre-existing findings in untouched files trains developers to ignore the layer, which destroys its
value.

**Trade-off.** Shallower than a real scanner. Stated plainly in `SECURITY.md` — this is a guardrail,
not a substitute.

---

## ADR-011 — A lint rule that fails the build if the injection notice is removed *(found while
building)*

**Context.** Prompt-injection mitigation lived as a sentence in a prompt file. Deleting it would have
broken nothing visibly.

**Alternatives.** (a) Trust reviewers to notice. (b) A comment asking people not to delete it.
(c) A lint rule.

**Chosen.** (c).

**Why.** A security control with no enforcement is a comment. The lint rule reads the prompt module
and fails the build if the untrusted-content notice is gone. It costs one rule and turns an intention
into a property.

---

## ADR-012 — The repair role has no code-strength gate *(a bug found by writing tests)*

**Context.** Routing originally required `codeStrength ≥ 0.55` to be eligible to repair. It looked
like good rigour.

**What happened.** Writing `tests/router.test.ts` failed, and the failure exposed something worse than
a test bug: our own 2B local model scores 0.45, so it was **excluded from the repair step entirely**.
The runtime would have silently stopped being able to repair anything offline — failing precisely when
the developer has no network and needs it most.

**Alternatives.** (a) Lower the threshold. (b) Remove the hard gate and express the preference through
difficulty weighting.

**Chosen.** (b).

**Why.** The intent was "prefer a stronger model for repair", and a *hard filter* is the wrong
mechanism for a preference. Difficulty weighting already gives code strength a large weight on hard
tasks, so a stronger model wins when one is available — while a weak local model stays eligible.
The `minCodeStrength` field remains for cases where exclusion is genuinely correct, and is now used
sparingly with a comment explaining exactly this trap.

**Lesson.** A capability gate that reads as rigour can be an availability bug. The test suite caught
it because the test asserted a property ("the router always has a candidate for repair") rather than
just a happy path.

---

## ADR-013 — Next.js and Tailwind, but a read-only control centre

**Context.** Time was limited and the demo needed a visual surface.

**Alternatives.** (a) Full CRUD web app. (b) Read-only viewer over the Project World. (c) No web UI,
CLI only.

**Chosen.** (b).

**Why.** Approvals and dangerous actions belong at the CLI where they are explicit and scriptable. A
read-only viewer keeps the web app free of write paths, which means it cannot become a second,
less-guarded way to mutate the world. It also reads `.attest/world.json` directly — no API layer, no
cache, no second source of truth to drift.

**Trade-off.** Approving a change from the browser is not possible. Deliberate.

---

## ADR-014 — Acceptance-criteria coverage gates the verdict *(the most important bug found)*

**Context.** During final verification I ran the live path — a real local open-weight model, a real
repository, no scripted edits — and asked it to add session authentication.

The model added a session check to `/api/me`, never created a login route, and left an unreachable
duplicate `return` statement behind. It implemented essentially none of the request.

Then every layer passed:

```
✓ security: no findings in 1 changed file(s)
✓ unit: 5/5 passing
✓ typecheck: exited 0
✓ regression: baseline preserved (5 → 5 passing)
VERDICT VERIFIED
```

**Why this was so serious.** The verdict function was not wrong. Every check that ran did pass, and
the baseline was honoured. But `VERIFIED` is read by a human as *"the thing you asked for is done"*,
and it was not done. The engine answered "did the checks pass?" while the developer was asking "did
you do what I asked?".

This is the exact failure mode the project exists to prevent, produced by the project, in the one code
path that is supposed to be the safeguard. If I had not run the live path and read the diff, the
write-up would have claimed a guarantee the tool did not provide.

**Root cause.** Verification checks *the repository's* declared checks. A repository's tests describe
behaviour that already exists. Adding a new behaviour does not make any existing test fail, so a suite
that is green before the change is still green after a change that does nothing useful. "All checks
pass" is a much weaker statement than it feels like.

**Alternatives.** (a) Accept it; document that verification is only as strong as the project's tests.
(b) Require the agent to always write tests, and fail if it does not. (c) Check whether the repository's
tests exercise the acceptance criteria, and cap the verdict when they do not.

**Chosen.** (c), with (a) documented alongside it.

**Why.** (a) is true but insufficient: it is a caveat in a doc that nobody reads at the moment they
read the word `VERIFIED`. (b) is too blunt — not every criterion is testable in a unit test, and an
agent writing a meaningless test to satisfy a gate would be worse than no gate. (c) targets the actual
question, and its weakness is visible in the record.

**Implementation.** For each acceptance criterion, extract concrete signals: HTTP routes, quoted
literals, and distinctive identifiers. Search the repository's test files — plus any test file the
change itself created — for those signals. A criterion naming a concrete surface that appears in no
test caps the verdict at `PARTIALLY_VERIFIED` and appears in the residual risk.

**Two bugs found while building it, both worth recording:**

1. **The loop recomputed the verdict and threw the cap away.** The engine produced a coverage-aware
   verdict; `AgentLoop` then called `computeVerdict(outcome.layers)` again without coverage and
   overwrote it. A safety gate that is bypassed by a redundant re-computation is not a gate. The loop
   now reads `outcome.verification.verdict` and no longer computes one — the engine is the single site
   where a verdict is produced.
2. **A false positive on a criterion naming the test command.** "Running `npm run test` must pass" was
   flagged as uncovered, because no *test file* contains the string `npm run test` — even though the
   `unit` layer runs exactly that. A check that cries wolf conditions developers to ignore it, which is
   worse than not shipping it. Criteria naming a project-declared command are now covered by
   definition.

**Trade-off.** The check is a heuristic. It detects whether a test *references* a surface, not whether
the test asserts anything. It can be satisfied by an empty test. It is documented as a smoke alarm in
the record itself, in `ARCHITECTURE.md`, and in the README's limitations. Overstating it would repeat
the original mistake at one remove.

**Lesson.** The most valuable thing that happened in this build was running the tool on itself and
reading the output honestly. A test suite that passes is evidence about the tests, not about the
product.

## Decision index

| ADR | Decision | Status |
|---|---|---|
| 001 | Anchor to one developer | Accepted |
| 002 | Verdict is a pure function | Accepted |
| 003 | Refuse non-open-weight models by default | Accepted |
| 004 | Snapshot checkpoints, not git reset | Accepted |
| 005 | Roll back before diagnosing | Accepted |
| 006 | One JSON document, not a database | Accepted, revisit at scale |
| 007 | Exact-string edits, not diffs | Accepted |
| 008 | Cut Temporal, MCP server, desktop | Accepted |
| 009 | Pre-flight baseline | Accepted |
| 010 | In-process, change-scoped security scan | Accepted |
| 011 | Lint-enforced injection notice | Accepted |
| 012 | No hard capability gate on repair | Accepted (bug fix) |
