# DECISION.md

**Date:** 2026-10-04 · **Decider:** Lead agent · **Status:** Accepted, supersedes brief assumptions contradicted by `RECONNAISSANCE.md`

---

## 1. Problem

A solo developer delegating work to AI coding agents does not stop working. They become the
**human orchestration layer**: re-explaining architecture to each agent, restoring lost context,
re-deriving why past decisions were made, and — above all — verifying that "Done" is actually done.
The agent's confidence is not evidence. So the developer manually runs the tests, inspects the diff,
finds what broke, and undoes it.

The bottleneck is not code generation. **It is trust and continuity.**

## 2. Target user (one real person)

A college-student / indie developer who ships full-stack and AI projects alone and already uses AI
coding agents daily. Their toolchain is fragmented across an agent, a terminal, GitHub, docs, a
browser, tests, and several models. They are the integration layer between all of it.

Deliberately **not** "any developer". The runtime is designed to generalize, but every P0 decision
optimizes for this one workflow.

## 3. Existing alternatives and the gap

See `RESEARCH.md` for the full sourced comparison. Summary of the gap:

| Capability | Typical agent CLI (Claude Code, Codex, Aider, Cline, OpenCode, Goose) | **Attest** |
|---|---|---|
| Persistent, cross-tool Project World | Per-session context, or a memory file the agent may ignore | First-class, versioned, inspectable entity graph |
| Checkpoint before every mutation | Optional, manual git | Automatic, replayable, tied to the task |
| Auto-rollback when **evaluation** fails | No — the human notices | Enforced: failed verdict ⇒ revert to checkpoint |
| Tamper-evident evidence record | Chat transcript at best | Structured record: intent→plan→diff→commands→tests→verdict |
| Deterministic verdict from the model's own claim | Model asserts success | Model claim is an *input*; verdict comes from executed checks |

## 4. Product thesis

> **An autonomous engineering runtime that gives AI agents a persistent project world, safe
> checkpointed execution, continuous verification, and recoverable autonomy — so a developer can
> supervise instead of coordinate.**

It never says "Done." It says **"Verified, here is the evidence"** — or it rolls back and says why.

## 5. Differentiation, stated honestly

Existing agents are good at *producing changes*. Attest's bet is that the scarce resource is
*justified confidence*: knowing which change is safe to keep and being able to undo it cheaply.
So Attest treats a task as a transaction — checkpoint, mutate, evaluate, commit-or-revert — and
treats the model as a *proposer and diagnostician*, never as the verifier. The verdict is computed
from executed commands, not generated text.

This is genuinely different from "an agent that writes code". It is not different from "an agent
with a git integration" — the differentiator lives in the **enforced evaluation gate** and the
**evidence artifact**, and the write-up must show both, not assert them.

## 6. MVP (P0) — the definition of done

```
[ ] attest init            create/attach a project world
[ ] attest analyze         scan repo → Project World (stack, tests, constraints, decisions)
[ ] attest task "<goal>"   natural-language engineering task
[ ] plan                   open-weight model produces a structured, inspectable plan
[ ] checkpoint             automatic reversible snapshot before any mutation
[ ] execute                tool runtime applies real file changes
[ ] verify                 multi-layer: typecheck · lint · tests · build · security scan
[ ] fail safely            a real failing check is detected and reported
[ ] diagnose               model explains the root cause from the actual failure output
[ ] rollback               bad state is reverted, provably, to the checkpoint
[ ] repair                 a corrective change is attempted
[ ] re-verify              checks re-run to a verdict
[ ] evidence               immutable record explaining why the result is trusted
[ ] memory                 outcomes and decisions persist into the Project World
[ ] rollback / inspect     human override at every step
```

## 7. Architecture

```
                    ┌──────────────────────────────┐
   CLI ────┐        │        CORE RUNTIME          │        ┌──── Web Control Center
   API ────┼───────▶│  ProjectWorld · ModelRouter  │◀───────┤     (read-only viewer)
   MCP ────┘        │  ToolRuntime · Verification  │        └──── MCP server (stretch)
                    │  Evidence · AgentLoop        │
                    └──────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
        LocalProvider      HostedOpenProvider    CloudProvider(optional)
        (Ollama, open      (gpt-oss-120b,        (never load-bearing)
         weights)           open weights)
```

Interfaces are adapters over one runtime. Only CLI + web are built for the MVP; API/MCP are kept
structurally possible and not faked.

## 8. AI strategy

- **Local open-weight by default** (Ollama; Gemma and Qwen-class coder models). Runs offline, no
  data leaves the machine, zero marginal cost.
- **Hosted open-weight as escalation** (`gpt-oss-120b` via the local OpenAI-compatible gateway) for
  the hardest reasoning step.
- **Any online/closed model is strictly optional and removable**; the default path must never
  require it. A test asserts the local-only path works.
- Routing is capability-aware and falls back on failure — not hard-coded to a vendor.

## 9. Sponsor strategy

Scored in `SPONSOR_MATRIX.md`. Rule adopted up front: **an integration is included only if it does
real architectural work and has an acceptance test.** No credential exists in this environment, so
paid-only sponsors are excluded automatically. Prize-chasing is explicitly out of scope.

## 10. Technology choices

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript on Node 22 | One language across runtime, CLI and web; fast, typed, no build graph |
| Repo | Single pnpm workspace, path aliases | A real build graph costs hours we do not have (R3) |
| Persistence | Embedded SQLite (or JSON store) | Zero-infra, offline, inspectable; one datastore only |
| Local AI | Ollama | Only viable on-device runtime present; permissive, no credentials |
| Web | Next.js + Tailwind, read-only views | Viewing evidence is the demo; writing through the web is not P0 |
| Testing | Vitest + the fixture app's own suite | Fast, TS-native |
| Checkpoints | Git commits/stash on a shadow ref | Reuses mature, battle-tested rollback instead of inventing one |

## 11. Risks

Carried from `RECONNAISSANCE.md` §5. The two that will decide the outcome:
**R1 theme/positioning** (mitigated by the re-anchor) and **R2 demo flakiness** (mitigated by
recording one real failure trace and replaying it deterministically).

## 12. Explicitly deferred (anti-bloat)

Desktop app, mobile, marketplace, theme systems, multi-agent theatre, Temporal, vector search,
fine-tuning, hosted deployment. Each is either cut or a stretch goal that may not touch P0.

## 13. Plan — next 13 hours

| Window | Work |
|---|---|
| T+0–0:45 | Recon, decisions, git, scaffold, standards (this) |
| T+0:45–2:30 | Project World + ModelRouter + ToolRuntime + checkpoints |
| T+2:30–5:00 | Agent loop end-to-end; verification engine; evidence records |
| T+5:00–6:30 | Fixture app + real test suite + controlled-failure scenario |
| T+6:30–8:30 | Web control center; CLI surface complete |
| T+8:30–10:00 | E2E test, demo script, **demo recording**, handover to friend |
| T+10:00–12:00 | Docs set + DEV.to article with embedded evidence |
| T+12:00–13:00 | Final verification: typecheck · lint · test · build · live demo run |

## 14. How we will know it worked

A developer asks for a real change to a real repo; Attest understands the project, plans, executes,
**hits a genuine failure**, diagnoses it, rolls back to a known-good state, repairs, re-verifies, and
hands back an evidence record. And the friend says it removed work from their day.
