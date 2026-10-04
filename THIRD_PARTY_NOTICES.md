# THIRD_PARTY_NOTICES.md

> What was reused, what was studied, and what was deliberately not taken.

The short version: **Attest contains no copied third-party source code.** It is built on six
permissively-licensed npm dependencies and a local model runtime. That was a deliberate choice, and
this file records the reasoning as well as the licences.

---

## 1. Direct runtime dependencies

| Package | Version range | Licence | Used for |
|---|---|---|---|
| [`zod`](https://github.com/colinhacks/zod) | ^3.24.1 | MIT | Tool input contracts and model output schema validation |
| [`picocolors`](https://github.com/alexeyraspopov/picocolors) | ^1.1.1 | ISC | Terminal colour in the CLI |

## 2. Development dependencies

| Package | Version range | Licence | Used for |
|---|---|---|---|
| [`typescript`](https://github.com/microsoft/TypeScript) | ^5.7.2 | Apache-2.0 | Type checking (`tsc --noEmit`) |
| [`tsx`](https://github.com/privatenumber/tsx) | ^4.19.2 | MIT | Running TypeScript directly, so the code that runs is the code that is reviewed |
| [`vitest`](https://github.com/vitest-dev/vitest) | ^2.1.8 | MIT | Test runner |
| [`@types/node`](https://github.com/DefinitelyTyped/DefinitelyTyped) | ^22.10.2 | MIT | Node type definitions |

## 3. Web application dependencies (`apps/web` only)

| Package | Version | Licence |
|---|---|---|
| [`next`](https://github.com/vercel/next.js) | 15.1.6 | MIT |
| [`react`](https://github.com/facebook/react) / `react-dom` | 19.0.0 | MIT |
| [`tailwindcss`](https://github.com/tailwindlabs/tailwindcss) + `@tailwindcss/postcss` | 4.0.0 | MIT |
| [`postcss`](https://github.com/postcss/postcss) | 8.5.1 | MIT |
| `@types/react`, `@types/react-dom` | 19.x | MIT |

These are isolated to the read-only control centre. The core runtime has no web dependencies.

## 4. Local model runtime

| Component | Licence | Note |
|---|---|---|
| [Ollama](https://github.com/ollama/ollama) | MIT | Installed separately by the user; not vendored. Speaks the Ollama HTTP API. |
| **Gemma 4** (`gemma4:e2b`) | **Apache-2.0** | Default local model. Apache-2.0, not the older custom Gemma Terms. Carries tool-calling support. |
| **Qwen 3.5** (`qwen3.5:4b`) | **Apache-2.0** | Documented alternative driver. 256K context, tool calling. |

**No model weights are redistributed by this repository.** The user pulls them; the licences above
are recorded so the choice is auditable rather than assumed.

> A note on why the default is Gemma 4 and not Gemma 3: Gemma 3 does **not** advertise tool-calling
> support on the Ollama model library, which disqualifies it as an agent driver. Gemma 4 is
> Apache-2.0 *and* supports tools. This was verified against the model library rather than assumed.

## 5. Studied but not used

These were evaluated during reconnaissance and deliberately not adopted. Recording them matters as
much as recording dependencies: "we looked and chose not to" is different from "we did not look".

### Agent frameworks — not used

| Project | Licence | Why not |
|---|---|---|
| [Roo-Code](https://github.com/RooCodeInc/Roo-Code) | Apache-2.0 | **Repository is archived** (last push 2026-05-15). Building on an archived project is a dead end. |
| [Kilo Code](https://github.com/Kilo-Org/kilocode) | MIT | The live successor, but adopting a full agent framework would have replaced the loop this project exists to demonstrate. |
| Cline, Aider, OpenCode, Goose, Continue | Apache-2.0 / MIT | Studied for the comparison in the write-up. Adopting one would make Attest a wrapper around a competitor's loop rather than a runtime with its own guarantees. |
| LangChain / LlamaIndex | MIT | Heavier abstraction than needed for a bounded, schema-validated prompt layer. `LlamaIndexTS` is archived. |

### Workflow engines — not used, and two rejected on licence

| Project | Licence | Verdict |
|---|---|---|
| [Temporal](https://github.com/temporalio/sdk-typescript) | MIT | Genuinely the right tool for durable execution. Rejected on **time**, not fit: the Workflow/Activity refactor is 4h+ and the checkpoint-and-rollback guarantee was worth more. See `DECISIONS.md` ADR-008. |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | Apache-2.0 | Permissive and a good fit. Deferred with Temporal. |
| **Inngest** | **SSPL-1.0** | **Rejected: licence.** Not OSI-approved and not compatible with this project's Apache-2.0 terms for anything beyond trivial use. |
| **Restate** | **BSL-1.1** | **Rejected: licence.** Business Source Licence — production use is restricted until the change date. |
| **Windmill** | **Apache-2.0 + AGPLv3 (mixed)** | **Rejected: licence.** Mixed licensing requires per-directory analysis; not worth it for a non-core subsystem. |

### Git tooling — not used

| Project | Licence | Why not |
|---|---|---|
| [libgit2](https://github.com/libgit2/libgit2) / nodegit | GPLv2 **with** linking exception | The linking exception makes it usable, but a native build for a snapshot mechanism is unnecessary complexity. Shelling out to `git` where git is needed keeps the dependency count at zero. |
| GitButler | FSL-1.1-MIT | Functional Source Licence: not OSI-approved for the first period after release. |

### Observability — not used

| Project | Licence | Why not |
|---|---|---|
| Langfuse, LiteLLM | MIT **plus** `ee/` / `enterprise/` directories under separate terms | Mixed licensing. The same questions are answered locally by the append-only audit log and recorded `ModelRun`s, with no new trust boundary. |
| Arize Phoenix | Elastic Licence 2.0 | Not OSI-approved. |

### Benchmarks — studied, not used

SWE-bench and similar harnesses were examined. They measure whether a model produces a correct patch.
This project's claim is about whether an agent's *completed* work is trustworthy and reversible, which
is a different question and needs an evaluator that runs inside the loop rather than a benchmark run
after it.

## 6. How dependencies were checked

For each candidate: the `LICENSE` or `COPYING` file was read from the source repository, and archiving
status and last-push dates were taken from the GitHub API. Findings were sampled on 2026-10-04 and are
recorded in `docs/RESEARCH.md` with links.

Licences were rejected on the basis of: not OSI-approved (SSPL, BSL, FSL, Elastic), mixed licensing
requiring per-directory analysis (Windmill, Langfuse, LiteLLM), or copyleft without a linking
exception that applies to a TypeScript project.

## 7. Attribution

No third-party source files are included in this repository, so no per-file attribution is required.
The `LICENSE` file contains the Apache-2.0 text under which this project itself is released.

If you believe something here has been attributed incorrectly, please open an issue.

## 8. Reproducing this audit

```bash
npm ls --all --json | node -e "..."   # full dependency tree with versions
cat package.json apps/web/package.json # direct dependencies only, kept deliberately small
```

The direct dependency count is **six** for the runtime plus six for the web app. Both were kept small
on purpose: every dependency is code that runs with the developer's privileges, and this project
executes model-directed actions, which makes the supply-chain surface a security concern rather than
just a maintenance one.
