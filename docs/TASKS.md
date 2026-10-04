# TASKS.md

> The plan, the state of each item, and what was deliberately cut.

Legend: **P0** must work · **P1** high value · **P2** nice to have

---

## Definition of done (from the brief)

Every one of these is a P0 requirement. Status is honest — `[x]` means it works and is tested.

| | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Create a project world | `[x]` | `attest init` → `packages/project-world/src/analyzer.ts` |
| 2 | Analyse a project | `[x]` | discovers stack, commands, test files, constraints, unknowns |
| 3 | Build project world | `[x]` | `WorldStore`, atomic JSON + append-only audit |
| 4 | Accept a natural-language task | `[x]` | `attest task "<intent>"` |
| 5 | Plan the task | `[x]` | interpreter + planner roles, schema-validated with retry |
| 6 | Execute the task | `[x]` | tool runtime, audited, permission-gated |
| 7 | Use open-source AI | `[x]` | router **refuses** non-open-weight models by default |
| 8 | Use tools | `[x]` | 10 tools, zod schemas, permission levels, timeouts |
| 9 | Modify the repository | `[x]` | `apply_edits` (atomic batch), `write_file`, `edit_file` |
| 10 | Create a checkpoint | `[x]` | `CheckpointManager`, tree-hashed snapshots |
| 11 | Run tests | `[x]` | layered engine, runs the project's own commands |
| 12 | Detect failure | `[x]` | `computeVerdict` + failure classification |
| 13 | Diagnose failure | `[x]` | repairer role, prompted with real assertion output |
| 14 | Repair failure | `[x]` | repair replayed/derived, re-applied from known-good |
| 15 | Re-run tests | `[x]` | second attempt, full re-verification |
| 16 | Produce evidence | `[x]` | `EvidenceRecord`, sealed with a digest |
| 17 | Update project memory | `[x]` | `memories` in the world; lessons recorded from failures |
| 18 | Show execution history | `[x]` | `attest status` / `attest tasks` / audit log / web UI |
| 19 | Rollback | `[x]` | automatic in-loop **and** `attest rollback` as a human override |
| 20 | Human can inspect the result | `[x]` | `attest evidence --markdown`, `attest explain`, web control centre |

**All 20 P0 items are complete.**

---

## P0 — completed

| | Item | Status |
|---|---|---|
| P0-1 | Domain model: tasks, plans, executions, checkpoints, failures, verification, evidence, memory | `[x]` |
| P0-2 | Repository analyser with honest `unknowns` and provenance-carrying constraints | `[x]` |
| P0-3 | World store with atomic writes and an append-only audit log | `[x]` |
| P0-4 | Model router: open-weight-first policy, ranking, fallback chain, capability probe | `[x]` |
| P0-5 | Providers: Ollama (local), OpenAI-compatible (hosted open-weight), Mock (deterministic) | `[x]` |
| P0-6 | Tool runtime: registry, zod contracts, permission model, path chokepoint, timeouts, audit | `[x]` |
| P0-7 | 10 tools across fs, search, shell, git | `[x]` |
| P0-8 | Checkpoint manager with verified restore | `[x]` |
| P0-9 | Verification engine: 7 layers, pre-flight baseline, computed verdict | `[x]` |
| P0-10 | Test-output parsers for node:test, vitest, jest, pytest, go test | `[x]` |
| P0-11 | In-process, change-scoped security scanner (12 rules) | `[x]` |
| P0-12 | Agent roles: interpreter, planner, implementer, repairer, reviewer | `[x]` |
| P0-13 | The loop with its five enforced invariants | `[x]` |
| P0-14 | Evidence assembly, digestion, sealing and markdown rendering | `[x]` |
| P0-15 | CLI: 14 commands with strict flag validation | `[x]` |
| P0-16 | Demo fixture: real service, real test suite, real constraint, real regression | `[x]` |
| P0-17 | 83 tests including four end-to-end proofs | `[x]` |
| P0-19 | Acceptance-criteria coverage gate | `[x]` |
| P0-20 | Sentry agent tracing (`gen_ai.*` spans, no-op without a DSN) | `[x]` |
| P0-21 | Local envelope-capture tests proving the spans are really emitted | `[x]` |
| P0-18 | `attest demo` scripted recovery demonstration | `[x]` |

## P1 — completed

| | Item | Status | Note |
|---|---|---|---|
| P1-1 | Web control centre | `[x]` | read-only: dashboard, evidence, audit, tools |
| P1-2 | Model router with measured capability probe | `[x]` | `attest models --probe` |
| P1-3 | Persistent project memory with keyword retrieval | `[x]` | used to feed context to later tasks |
| P1-4 | Independent reviewer routed away from the author | `[x]` | `excludeModels` / `excludeProviders` |
| P1-5 | Observability | `[x]` | audit log, `modelRuns`, and hand-written Sentry `gen_ai.*` spans |
| P1-6 | Token/latency tracking per model call | `[x]` | recorded in `ModelRun` |
| P1-7 | Human override: pause/resume/cancel/approve/reject/rollback | `[x]` | `recordHumanOverride`, `attest rollback` |

## P1 — deferred, with reasons

| | Item | Why deferred |
|---|---|---|
| P1-8 | **MCP server** | The tool registry is already the right shape, but a half-wired MCP server would add a *new path that bypasses the permission model*. Shipping it would weaken the tool-safety story rather than strengthen it. Designed for; not shipped. |
| P1-9 | **External agent delegation** (Antigravity, Claude Code, Codex) | Requires a stable structured-result contract and per-agent sandboxing. Rushing it would produce an unaudited write path. |
| P1-10 | **Temporal durability** | `temporal server start-dev` is available locally and the loop is a clean state machine, but the Workflow/Activity refactor is 4h+ and the checkpoint-and-rollback guarantee is worth more than durable execution at this scale. Described in `DECISIONS.md` ADR-008. |
| P1-11 | ~~Sentry agent tracing~~ | **Shipped** — hand-written `gen_ai.*` spans, since SDK auto-instrumentation does not cover Ollama. Zero cost when `SENTRY_DSN` is unset. |

## P2 — cut

| | Item | Why cut |
|---|---|---|
| P2-1 | Tauri desktop shell | Web + CLI already deliver the experience; a desktop shell adds packaging, not capability |
| P2-2 | Mobile client | Explicitly out of scope; the API shape supports it |
| P2-3 | Vector/semantic memory | Keyword retrieval is adequate at this size; the `retrieve()` seam exists |
| P2-4 | Fine-tuning | No honest before/after evaluation could be produced in the window |
| P2-5 | Marketplace, plugin system, theme system | Anti-bloat rule |
| P2-6 | Multi-agent choreography | One well-instrumented loop beats five agents performing coordination |
| P2-7 | Hosted deployment | Not needed to demonstrate the thesis; would add a network trust boundary |

---

## What was actually hard

Recorded because it is the useful part for anyone reading this later.

1. **Making the demo honest.** A live demo of an autonomous recovery loop is a coin flip. Replaying
   recorded change sets through the real machinery, and *labelling them in the output and in the
   evidence*, was the resolution. See `DEMO.md` §6.
2. **Not overclaiming.** The temptation to make `VERIFIED` reachable on a repository with no tests is
   enormous. The rule "a required layer that did not run yields `UNVERIFIED`" is four lines of code
   and the single most important four lines in the project.
3. **The repair-role capability gate.** A routing gate that looked like rigour silently excluded our
   own local model from repairing — an availability bug that would only appear offline, when it
   matters most. Found by a test; see `DECISIONS.md` ADR-012.
4. **Distinguishing "I broke it" from "it was already broken".** Solved with a pre-flight baseline,
   which also turns a plausible-sounding verdict into an honest one.
5. **Prompt injection without depending on the model.** The resolution is not a better prompt; it is
   making sure nothing security-relevant depends on the prompt at all.
6. **The product failed its own promise, and a live run caught it.** A local model was asked to add
   authentication, added a session check to `/api/me`, never created a login route, and left dead code
   behind. All five tests passed, because they describe *existing* behaviour. Attest returned
   `VERIFIED`. The verdict function was correct and the product was still misleading. Fixed by adding
   an acceptance-criteria coverage gate — see `DECISIONS.md` ADR-014. This is the strongest evidence
   for the project's own thesis: a claim of success is not evidence of success, and the only way to
   find that out about your own tool is to run it and look.

## Milestones

| Window | Work | Status |
|---|---|---|
| T+0:00–0:45 | Reconnaissance, decisions, git, scaffold | `[x]` |
| T+0:45–2:30 | Project World, ModelRouter, ToolRuntime, checkpoints | `[x]` |
| T+2:30–5:00 | Agent loop, verification engine, evidence | `[x]` |
| T+5:00–6:30 | Fixture, test suite, controlled-failure scenario | `[x]` |
| T+6:30–8:30 | Web control centre, CLI completion | `[x]` |
| T+8:30–10:00 | E2E tests, demo script, evidence capture | `[x]` |
| T+10:00–12:00 | Documentation set, DEV write-up | `[x]` |
| T+12:00–13:00 | Final verification: typecheck · lint · test · live demo | `[x]` |
| T+13:00+ | Live runs on the local model; coverage gate added in response to an observed failure | `[x]` |
