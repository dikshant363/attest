*This is a submission for the [Hacktoberfest Weekend Challenge: Build for a Friend](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)*

---

# I built my friend Aarav an agent that refuses to say "done"

## What I Built

My friend **Aarav** is a second-year CS student. He builds full-stack and AI projects on his own, and he uses coding agents every day. He is exactly who these tools are made for — and he is still doing the boring part by hand.

Here is the moment that made me build this.

Aarav asked an agent to add authentication to one of his projects. It worked. Or rather, it *said* it worked. And then Aarav spent the next forty minutes doing the actual work: reading the diff, re-running the tests, figuring out which of the changed files mattered, discovering that the health-check endpoint now returned 401, and undoing it.

The agent said "Done" in nine seconds. The work took forty minutes.

So I built **Attest**, an autonomous engineering runtime that will not say "done". It says **verified** — or it rolls back and tells you why.

The whole thing is one idea: **treat an engineering task as a transaction.**

```
INTENT → INTERPRET → PLAN → BASELINE → CHECKPOINT → EXECUTE → VERIFY
                                                          │
                                                ┌── fails ──┐
                                                ↓           │
                                            ROLLBACK → DIAGNOSE → REPAIR
                                                          │
                                                    EVIDENCE
```

Nothing mutates outside a checkpoint. A verdict is never written by a model. A failed attempt is rolled back *before* it is repaired. And every task ends with a sealed record that answers the only question Aarav actually cares about: **why should I believe you?**

## The problem is not that AI can't write code

This is the part I want to be precise about, because I think it's the part most tooling gets wrong.

AI writes code fine. That stopped being the bottleneck a while ago. Since then I've watched the bottleneck move somewhere nobody was looking: **verification, and continuity.**

Aarav's toolchain is an agent, a terminal, GitHub, docs, a browser, a test runner, and two or three models. He is the integration layer between all of it. Every new agent session starts with him re-explaining his own architecture. Every decision he made last week has to be re-derived. And every change an agent makes has to be manually verified, because the agent's confidence is not evidence.

The paradox is worth naming: **making code generation faster does not reduce his work.** It increases the volume of unverified change and shifts the work downstream. He gets more done and trusts less of it.

So the thing to build was not a better code generator. It was a system that closes the loop.

## Why the existing tools weren't enough

I looked hard at what's already out there, because building a worse version of an existing tool is a waste of a weekend.

Claude Code, Codex, Aider, Cline, Continue, OpenCode, Goose — these are good tools and I use some of them. They're good at producing changes. What surprised me was how much the gap is acknowledged in their own documentation.

Claude Code's checkpointing docs, for example, are unusually candid: checkpoints [don't track changes made by bash commands](https://code.claude.com/docs/en/checkpointing), don't restore subagent edits, aren't a replacement for version control, and rewind is user-initiated.

Cline is the closest to what I wanted — it maintains a [shadow git repository](https://docs.cline.bot/core-workflows/checkpoints) and commits after every tool use, which is genuinely clever, and its docs are right that it makes the cost of a mistake nearly zero. But **restore is a button.** You click Restore next to a step. Nothing fires it automatically. If a test fails, Cline does not roll back, because nothing is watching the tests.

That's the gap, and it's narrow and specific: **checkpointing exists, but evaluation doesn't gate anything.** The pieces are all there; the wire between them isn't.

I couldn't find anything in this space that does *evaluation-triggered auto-rollback plus repair as one unattended transaction*. That's the thing I built.

## The demo

Attest ships with a small but real service: a request handler, a live HTTP server, and five `node:test` tests. It has one behaviour that matters — `GET /health` is public, because the platform health check calls it before any session exists. That constraint is declared in a file:

```json
{
  "statement": "GET /health must remain reachable without authentication...",
  "severity": "hard"
}
```

The task is the one Aarav actually ran: *add session-based authentication, and make sure the platform health check keeps working.*

Here's what happens:

```
▸ INTERPRET     understood: add session auth, keep the health check reachable
▸ PLAN          1. [edit] add session auth scoped to the API surface
                2. [verify] run the test suite and type checker
                risks: the health check must stay public
▸ BASELINE      baseline green: 5 passing     ← before anything is touched
                ◆ checkpoint cp_…  (7 files captured)
▸ EXECUTE       applied the change
▸ VERIFY        pass  security
                FAIL  unit
                pass  typecheck
✗ FAILURE       test_assertion in unit
                | not ok 1 - GET /health is public and reports ok
                |   expected: 200
                |   actual:   401
▸ ROLLBACK      ↩ rollback verified (7 restored, 0 removed)
▸ DIAGNOSE      the auth guard was applied to the whole request surface, so it ran
                before the public /health route and before route matching
▸ EXECUTE       (repair, attempt 2)
▸ VERIFY        pass  security
                pass  unit
                pass  typecheck
VERDICT         VERIFIED
```

Notice what the agent did *wrong*. It didn't write broken code. It wrote **plausible** code: a session guard applied to the request surface. That is one of the most common ways a real authentication change takes down a real production service. It looked right.

And notice what Attest did: it didn't ask a model whether the change was good. It ran the project's own tests, which failed, and then it **rolled the repository back to a state it could prove was good.**

That proof matters. After restoring, the runtime recomputes a hash over every file and compares it to the checkpoint:

```
↩ rollback verified (7 restored, 0 removed)
```

If those hashes don't match, the rollback is reported as failed and the loop refuses to continue autonomously. A rollback that only *appears* to work is worse than no rollback at all.

Then it diagnosed from the actual assertion output, repaired, re-verified, and produced this:

```
✅ VERIFIED  ev_…  task=task_…
  intent     : Add session-based authentication, and make sure the platform health check keeps working.
  files      : 2 changed
  models     : gemma4:e2b (open-weight)
  layers     : security=pass unit=pass typecheck=pass
               lint=skipped build=skipped e2e=skipped regression=pass
  failures   : 1
  rollbacks  : 1
  residual   : 4 item(s)
```

### Being honest about the demo

The first edit and the repair in `attest demo` replay **recorded change sets**. Everything else is real: the baseline, the checkpoint, the change applied through the audited tool runtime, the multi-layer verification running the project's real `node:test` suite, the rollback and its hash verification, the re-verification, the verdict, the evidence.

I made that choice deliberately. A live demo of an autonomous recovery loop is a coin flip, and a coin flip is not evidence. It's labelled as replayed in the terminal output *and* in the evidence record, so nobody can mistake it for model output. The live path is one command away:

```bash
attest task "Add session-based authentication, and make sure the platform health check keeps working."
```

Here the model reads files through the tool runtime and writes its own edits. It might succeed first try. It might hit the same regression and recover. Either way the machinery is identical, because it isn't a script — it's the loop.

### The test I'm proudest of

The most important behaviour is what happens when recovery *fails*. There's an end-to-end test where the "repair" reintroduces the same bug, and it asserts:

```ts
expect(result.task.verdict).toBe("ROLLED_BACK");           // not VERIFIED
const after = await readFile("src/app.ts");
expect(after).toBe(pristine);                              // byte-for-byte identical
await expect(access("src/middleware")).rejects.toThrow();  // the new file is gone
expect(fixtureResult.ok).toBe(true);                       // nothing left broken
```

**An agent that fails safely is worth more than one that usually succeeds.** That test is the product.

## How it works

Five properties are enforced *in code*, not by convention:

| Property | How |
|---|---|
| Nothing mutates outside a checkpoint | The loop creates a checkpoint before every attempt. There is no code path that writes first. |
| A verdict is never authored by a model | `computeVerdict()` is a pure function over executed layer results. |
| A failed attempt is rolled back before it is repaired | The repair prompt is built from a workspace that has already been restored, verified by tree hash. |
| Absence of evidence is never success | A required layer that could not run produces `UNVERIFIED`, not `VERIFIED`. |
| Passing checks is not doing the work | An acceptance criterion that names a concrete surface no test references caps the verdict at `PARTIALLY_VERIFIED`. |
| Open-source AI is core, not decoration | The router **refuses** non-open-weight models by default. |

That fourth row is four lines of code and it's the most important thing I wrote. The temptation to let a `VERIFIED` verdict be reachable on a project with no tests is enormous, and it would have made the whole record worthless.

The fifth row is a claim I refused to leave to a README. Being "open-source AI first" is easy to write and easy to quietly abandon the first time a hard step stumbles. So the router checks `weightClass` and refuses anything that isn't open unless you explicitly pass `ATTEST_ALLOW_PROPRIETARY=1`. There's a test asserting the refusal. A policy that's a default erodes; a policy that's a refusal is testable.

### The evidence record

```
Task
 ├── intent          your words, verbatim
 ├── interpretation  what it understood — labelled as interpretation, not fact
 ├── plan            what it intended
 ├── changes         what actually changed
 ├── commands        what actually ran, with exit codes
 ├── tools           which tools, at which permission level
 ├── models          which models, WITH weight class
 ├── tests           counts parsed from the runner's own output
 ├── failures        the real assertion text
 ├── repairs         each attempt and whether it resolved
 ├── rollbacks       each restore, and whether it was verified
 ├── verification    every layer: pass / fail / did not run
 ├── verdict         computed, with reasons
 └── residual risk   what you should still check yourself
```

The record is sealed with a digest. You can demonstrate the seal in thirty seconds: open the JSON, change `verdict` to `VERIFIED`, run `attest verify`, and watch it break. That's the difference between an audit trail and a chat transcript with a nice font.

## Why Does Open Innovation Matter?

This is the part I want to get right, because for Attest it isn't a slogan — it's load-bearing in three concrete ways.

### 1. The default path runs on my laptop with no internet

Attest's default model is **Gemma 4** (`gemma4:e2b`), running locally through Ollama. **Apache-2.0**, not the older custom Gemma terms. Around 3.5 GB, comfortably inside the 16 GB on this M4.

That means: no API key, no account, no network, no per-token cost, and **Aarav's code never leaves his machine.** For a tool that reads your repository, your diffs, and your test output, "does this send my source code to someone's server?" is not a minor question. With a local model the answer is simply no.

And it isn't a toy. A local 2B model planning a change against a repository it can read is genuinely useful, and where it isn't enough, the escalation path is still open weights.

### 2. I can prove the open path is the real path

This is where it stops being a claim. Most "we use open models" projects have a closed model quietly doing the actual work with an open one for decoration. I made that structurally impossible to hide:

- The router refuses non-open weights by default.
- Every `ModelRun` records `weightClass`, and the evidence record prints it.
- The end-to-end test asserts `evidence.modelsUsed.every(m => m.weightClass === "open-weight")`.

So when Aarav opens a record and sees `gemma4:e2b (open-weight)`, that's not marketing. It's an assertion that would fail the test suite if it stopped being true. **Openness you can test is openness you can trust.**

### 3. I could actually read the model

Here's the thing that made this project possible in a weekend, and I don't think I could have done it with a closed API.

I tried a design where the repair role required a minimum "code strength". It looked like rigour. Then my tests failed, and I realised what I'd actually built: our own 2B local model scores 0.45, so it was **excluded from repairing anything, ever.** The runtime would have silently stopped being able to recover whenever Aarav was offline — precisely when he'd need it most.

I found that because I could reason about the model's actual properties and because the model was a swappable component behind my own abstraction. A capability gate that reads as discipline was an availability bug, and the fix was to express *preference* through weighting instead of *exclusion* through a filter.

That kind of correction only happens when the pieces are yours.

### And the honest bit

There's a real trade-off. A frontier model would write better code than `gemma4:e2b`, and I'm not going to pretend otherwise. Attest's answer isn't "small models are as good" — it's **"a smaller model whose work is verified, reversible, and auditable is more useful to Aarav than a bigger model whose work he has to check himself."**

Verification substitutes for capability. That's the whole bet.

## My Agent Session

<!-- DevRelay was not used for this build. If you install it (curl -fsSL https://devrelay.com/install.sh | sh,
     then sign in with MLH and ask your agent to save the session), replace this section with the link and
     the agent_session tag. Otherwise leave it as written — it is accurate. -->

I didn't use DevRelay, so rather than embed a transcript let me point at something better: **the tool records its own agent sessions, and they're in the repository.**

Every task Attest runs produces a sealed evidence record. Two of them are committed from unscripted live runs on the local open-weight model, and they are more useful than a chat log because they're structured, verifiable, and include the parts a transcript leaves out:

- [`docs/evidence/live-local-model-failed-safely.md`](https://github.com/dikshant363/attest/blob/main/docs/evidence/live-local-model-failed-safely.md) — the model broke the HTTP server, the tests caught it, and the workspace was restored byte-for-byte. Verdict: `ROLLED_BACK`.
- [`docs/evidence/live-local-model-recovered.md`](https://github.com/dikshant363/attest/blob/main/docs/evidence/live-local-model-recovered.md) — the model violated a declared constraint, diagnosed its own violation from the failing assertion, and repaired it. Verdict: `VERIFIED`.

Each one carries a digest, so you can confirm it hasn't been edited since it was written.

The build process itself is documented the same way: [`docs/DECISIONS.md`](https://github.com/dikshant363/attest/blob/main/docs/DECISIONS.md) has all 14 architecture decisions including the two that were wrong, and [`docs/TASKS.md`](https://github.com/dikshant363/attest/blob/main/docs/TASKS.md) records what was cut and why.

## Prize Categories

I'm entering the categories where the technology does real work in the architecture, and only those. Everything below is either demonstrated in the repo or explicitly marked as not yet configured.

### Best Use of Gemma

Gemma 4 *is* the inference layer. It plans the change, and it's what repairs the change after a failure, running locally through Ollama with no API key. There's no decorative Gemma call in this project — remove it and the core loop stops working.

I chose Gemma 4 over Gemma 3 for a specific, verifiable reason: Gemma 3 does **not** advertise tool-calling support on the Ollama model library, which disqualifies it as an agent driver. Gemma 4 is Apache-2.0 *and* supports tools. I checked rather than assumed.

### Best Use of Sentry Agent Tracing

<!-- PENDING: paste the trace URL and a screenshot here once SENTRY_DSN is set.
     Delete this comment and the note below when done. If the DSN is not configured before
     submitting, REMOVE THIS SECTION — an unclaimed category is better than a claimed one. -->

Attest emits three kinds of span:

| Span | What it records |
|---|---|
| `gen_ai.invoke_agent` | One per task, carrying the final verdict, failure/repair/rollback counts, and which models were used |
| `gen_ai.chat` | One per model call: model, provider, latency, token counts, whether the schema validated, and whether the router had to fall back |
| `gen_ai.execute_tool` | One per tool call: tool name, permission level, whether it mutates the workspace |

One implementation detail worth calling out: **Sentry's Node SDK does not auto-instrument Ollama.** Its auto-instrumentation covers OpenAI, Anthropic, the Vercel AI SDK and LangChain. Since our whole point is the local open-weight path, I wrote the spans by hand against the `gen_ai` semantic conventions. That turned out to be a feature — the trace records what actually happened rather than what an integration assumed about a provider.

Tracing is opt-in via `SENTRY_DSN` and costs nothing when disabled: the SDK is never even imported, so Attest still runs with no network at all.

One thing I want to be precise about: I could not verify this against a real Sentry project without an account, so I verified it a different way. The test suite points the SDK at a **local HTTP server that captures the envelopes it would have sent**, and asserts that the three span types arrive with the right attributes:

```ts
expect(body).toContain("gen_ai.invoke_agent");
expect(body).toContain("gen_ai.chat");
expect(body).toContain("gen_ai.execute_tool");
expect(body).toContain("gemma4:e2b");
expect(body).toContain("open-weight");
// and nothing that would leak the repository
expect(body).not.toContain("TODO: sessions are not implemented");
```

That means the claim "Attest emits `gen_ai` spans" is verifiable by anyone who clones the repo, with or without a Sentry account. It is also, I think, the right instinct for this project: if a claim can't be checked by the person reading it, it's marketing.

### Best Use of Render

<!-- Fill in with the deployed URL after connecting the repo. -->

The read-only control centre — verdicts, the latest evidence record, verification layers, model usage with weight class, constraints, and the audit log — is deployed on Render. It's a Next.js app that reads the Project World directly from disk, with no API layer and no cache, because a second source of truth is a second thing that can be wrong.

## I ran it on a real model, and it lied to me

Everything above is the product working. Here is the part where it didn't, because it's the most useful thing I can tell you.

Near the end I stopped using the scripted demo and ran the live path on the local model. Real repository, real `node:test` suite, no replayed edits — `gemma4:e2b` doing its own reading, planning and writing, entirely offline.

First run: the model edited `src/server.ts` and broke the HTTP server. The test suite caught it. Attest rolled back, diagnosed, attempted a repair that also failed, rolled back again, and returned:

```
↩️  ROLLED BACK
  files      : 1 changed
  layers     : security=pass unit=FAIL typecheck=pass regression=FAIL
  failures   : 2
  rollbacks  : 2
```

**The workspace was byte-for-byte identical to how it started**, all five tests still passed, and the record said plainly that nothing had been applied. A 2B model had just tried and failed to break my friend's repository, and the repository was fine. That's the safety property, demonstrated live, by accident, on a model that wasn't good enough to succeed.

Second run: the model succeeded. It was asked to add session authentication, it made a change that violated the "`/api/me` must return 401 without a session" constraint, the tests caught it, it was rolled back, and then — this is the part I didn't expect — **the model diagnosed its own violation**:

> *"The previous change modified the logic for `/api/me` to return a 200 OK with user data if a session existed, which violates the hard constraint that GET /api/me must return 401 when there is no session."*

Then it fixed it. `VERIFIED`, 5/5.

Great. Except I read the diff.

The model had added a session check to `/api/me` and **never created a login route**. It left an unreachable duplicate `return` statement behind. It had implemented essentially none of what was asked.

And every layer passed:

```
✓ security: no findings in 1 changed file(s)
✓ unit: 5/5 passing
✓ typecheck: exited 0
✓ regression: baseline preserved (5 → 5 passing)
VERDICT VERIFIED
```

**My tool told me a feature was done when it wasn't.**

### Why this happened, and why it matters

The verdict function wasn't wrong. Every check that ran, passed. The bug is deeper and more interesting than that.

A repository's test suite describes the behaviour that **already exists**. Adding a new behaviour doesn't make any existing test fail. So a suite that's green before a change is still green after a change that does nothing useful. "All checks pass" is a *much* weaker statement than it feels like — and I had been reading it as "the request is satisfied".

The engine answered **"did the checks pass?"** while I was asking **"did you do what I asked?"**

This is the exact failure mode Attest exists to prevent. My own tool produced it. If I hadn't run the live path and actually read the diff, this post would have ended with me claiming a guarantee I hadn't built.

### The fix

I added a fifth check, and it gates the verdict.

For each acceptance criterion, Attest extracts the concrete things it names — HTTP routes, quoted literals, distinctive identifiers — and searches the repository's test files for them, *including any test file the change itself created*. A criterion that names a concrete surface which appears in no test caps the verdict:

```
VERDICT  PARTIALLY_VERIFIED
  ✓ security: no findings in 3 changed file(s) (1 exempt)
  ✓ unit: 8/8 passing
  ✓ typecheck: exited 0
  ✓ regression: baseline preserved (5 → 8 passing)
  ⚠ no test exercises this acceptance criterion:
      "POST /api/login accepts valid credentials and establishes a session"
  ⚠ every executed check passed, but at least one requested behaviour is
    untested, so the change cannot be called fully verified
```

The cap is deliberate: it can only ever **lower** a verdict, never raise one. And the criterion shows up in the residual-risk section, which is the part a developer actually reads.

The recorded demo now also adds a test for the login route — which is what a competent engineer does, and what makes the coverage check pass honestly.

### Two bugs I found while fixing it

**1. My loop was throwing the new gate away.** The verification engine computed a coverage-aware verdict; then `AgentLoop` called `computeVerdict()` *again* without the coverage, and overwrote it. A safety gate that gets bypassed by a redundant re-computation is not a gate. The loop now reads the engine's verdict; there is exactly one place a verdict is produced.

**2. My new check cried wolf immediately.** It flagged the criterion *"Running `npm run test` must pass"* as untested, because no test file contains the string `npm run test` — even though the `unit` layer runs precisely that. A check that produces false alarms teaches developers to ignore it, which is worse than not shipping it. Criteria that name a project-declared command are now covered by definition.

### The honest limitation

The coverage check is a **heuristic**, and I've labelled it as one everywhere it appears. It detects whether a test *references* the surface a criterion names — not whether the test asserts anything meaningful. It could be satisfied by an empty test. It's a smoke alarm, not a fire-suppression system.

But a smoke alarm that says *"nothing here tests the route you just added"* is worth having. And claiming more than that would just be repeating my original mistake one level up.

**The real lesson:** the most valuable thing that happened in this build wasn't the architecture. It was running the tool on itself and reading the output honestly. A passing test suite is evidence about the tests, not about the product — which is, more or less, the entire thesis.

## What I learned

**1. The most valuable line of code was a refusal.**
Making `VERIFIED` unreachable when a required check couldn't run was four lines. It's the difference between a tool that helps you trust and a tool that helps you *feel* like you can trust. The second one is dangerous.

**2. A test caught a bug that would only have appeared offline.**
The capability-gate bug above was invisible in normal use and would have surfaced exactly when Aarav had no network. I only found it because a test asserted a *property* ("the router always has a candidate for repair") instead of a happy path.

**3. Prompt injection mitigation should not depend on the prompt.**
Attest tells the model that repository content is untrusted data, and a lint rule fails the build if that notice is removed. But that's a mitigation, and I treated it as one: path confinement, the permission model, the command deny list and the verdict computation none of them care what the model was persuaded to believe.

**4. "Done" is not a status. It's a claim.**
The entire product is the difference between those two sentences.

## What comes next

- **MCP server**, so other agents can drive the same tool surface. The registry is already the right shape — but I deliberately didn't ship it half-wired, because an unaudited second path into the permission model would make the safety story *weaker*, not stronger.
- **Durable execution** (Temporal) so a task survives a crash mid-repair. Designed, not shipped.
- **Sandboxing.** Right now the command policy is a guardrail, not a container. That's stated plainly in `SECURITY.md`.
- **The handover.** I'm giving this to Aarav this week and I'll report what he says.

## Code

**https://github.com/dikshant363/attest** — Apache-2.0

```bash
npm install
ollama pull gemma4:e2b
node bin/attest.mjs init --dir examples/auth-fixture
node bin/attest.mjs demo --dir examples/auth-fixture
node bin/attest.mjs evidence --markdown --diff
```

83 tests, including four end-to-end proofs: the recovery loop, safe failure when repair is impossible, the coverage gate catching an untested change, and a change that adds its own test being credited for it. Six runtime dependencies.

The docs are the part I'd point a reviewer at: [`ARCHITECTURE.md`](https://github.com/dikshant363/attest/blob/main/docs/ARCHITECTURE.md) for the design and its trade-offs, [`SECURITY.md`](https://github.com/dikshant363/attest/blob/main/docs/SECURITY.md) and [`THREAT_MODEL.md`](https://github.com/dikshant363/attest/blob/main/docs/THREAT_MODEL.md) for what it does *not* protect against, [`DECISIONS.md`](https://github.com/dikshant363/attest/blob/main/docs/DECISIONS.md) for the reasoning — including the decision that was wrong.

---

*Built for Aarav, who should be spending his weekends building things, not babysitting agents.*
