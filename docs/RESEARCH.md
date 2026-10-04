# Attest — Research Report

**2026-10-04.** Licenses read from each repo's actual `LICENSE`/`COPYING` via `raw.githubusercontent.com`; stars/`pushed_at`/`archived` from the GitHub REST API; Ollama tags, sizes and capability badges scraped from `ollama.com/library/.../tags`. `PUSHED` = last push to any branch, not a release. Anything unreachable is marked **UNVERIFIED** (a GitHub API rate limit of 60/hr was exhausted mid-run).

---

## 1. Reuse-before-build candidates

### 1.1 Coding agents / harnesses
| Name | License | Maintained | Recommendation |
|---|---|---|---|
| [OpenHands](https://github.com/OpenHands/OpenHands) | MIT ([LICENSE](https://raw.githubusercontent.com/OpenHands/OpenHands/main/LICENSE)) | PRs merged 2026 ([#8122](https://github.com/OpenHands/OpenHands/pull/8122)) | **Adapt** — sandbox + event-stream design is closest prior art to a verification runtime |
| [Cline](https://github.com/cline/cline) | Apache-2.0 | 69,835★, PUSHED 2026-10-03 | **Adapt** — the [shadow-git checkpoint](https://docs.cline.bot/core-workflows/checkpoints) pattern is exactly our reversible-checkpoint primitive |
| [OpenAI Codex CLI](https://github.com/openai/codex) | Apache-2.0 | 127,839★, PUSHED 2026-10-04 | **Integrate** — run as a pluggable executor behind our checkpoint/eval layer |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) | MIT | 20,488★, PUSHED 2026-09-28 | **Adapt** — steal the constrained agent-computer-interface idea |
| [Goose](https://github.com/aaif-goose/goose) | Apache-2.0 | Active (renamed from `block/goose`) | **Integrate** — MCP-native execution substrate |
| [Aider](https://github.com/Aider-AI/aider) | Apache-2.0 | 49,374★, PUSHED 2026-05-22 (stale) | **Adapt** — [repo map](https://aider.chat/docs/repomap.html) concept; [git integration](https://aider.chat/docs/git.html) already auto-commits every edit and offers `/undo` |
| [opencode](https://github.com/anomalyco/opencode) | MIT ([LICENSE](https://raw.githubusercontent.com/anomalyco/opencode/main/LICENSE)) | Active (renamed from `sst/opencode`) | **Integrate** |
| [Kilo Code](https://github.com/Kilo-Org/kilocode) | MIT ([LICENSE](https://raw.githubusercontent.com/Kilo-Org/kilocode/main/LICENSE)) | Active | **Adapt** — live successor to the now-archived Roo Code |
| [Continue](https://github.com/continuedev/continue) | Apache-2.0 | 36,111★, PUSHED 2026-10-04 | **Ignore** — IDE-bound, no orchestration surface |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code) | Apache-2.0 | 24,290★, PUSHED 2026-05-15, **`archived: true`** | **Ignore — repo is archived.** Do not build on it |
| [Plandex](https://github.com/plandex-ai/plandex) | MIT | 15,690★, PUSHED **2025-10-03** (~1yr stale) | **Ignore** |

### 1.2 Durable workflow / runtimes
| Name | License | Recommendation |
|---|---|---|
| [Temporal TS SDK](https://github.com/temporalio/sdk-typescript) | MIT | **Integrate** — the correct durable checkpoint-loop engine |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | Apache-2.0 | **Adapt** — TS-native durable tasks; far faster to adopt in 12h than Temporal |
| [Dagger](https://github.com/dagger/dagger) | Apache-2.0 | **Integrate** — reproducible containerized verification *layers* |
| [Inngest](https://github.com/inngest/inngest) | **SSPL-1.0** ([LICENSE.md](https://raw.githubusercontent.com/inngest/inngest/main/LICENSE.md)) | **⚠ Flag SSPL** — do not bundle |
| [Restate](https://github.com/restatedev/restate) | **BSL-1.1** ([LICENSE](https://raw.githubusercontent.com/restatedev/restate/main/LICENSE)) | **⚠ Flag BSL** — restricted; avoid |
| [Windmill](https://github.com/windmill-labs/windmill) | **Mixed Apache-2.0 / AGPLv3** | **⚠ Flag AGPL** — per-directory trap |

### 1.3 MCP (TypeScript)
| Name | License | Recommendation |
|---|---|---|
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT → **Apache-2.0** transition ([LICENSE](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/LICENSE)) | **Reuse** — official, client+server |
| [FastMCP TS](https://github.com/punkpeye/fastmcp) | MIT | **Reuse** — fastest path to exposing our evidence tools |
| [MCP servers](https://github.com/modelcontextprotocol/servers) | SPDX not declared (**UNVERIFIED** at repo level) | **Integrate** selectively; check each server's license |

### 1.4 Code indexing / context building
| Name | License | Recommendation |
|---|---|---|
| [tree-sitter](https://github.com/tree-sitter/tree-sitter) | MIT | **Reuse** — symbol extraction for the Project World |
| [ast-grep](https://github.com/ast-grep/ast-grep) | MIT | **Reuse** — structural search/rewrite; ideal for deterministic verifiers |
| [Repomix](https://github.com/yamadashy/repomix) | MIT | **Reuse** — repo → LLM-ready context in one step |
| [SCIP](https://github.com/scip-code/scip) | Apache-2.0 | **Adapt** — code-intelligence index ("what references this?") |
| [Gitingest](https://github.com/coderamp-labs/gitingest) | MIT | **Integrate** — cheap repo digest to seed the world |

### 1.5 Project memory & retrieval
| Name | License | Recommendation |
|---|---|---|
| [Cognee](https://github.com/topoteretes/cognee) | Apache-2.0 | **Integrate** — graph+vector memory; best Project World backend candidate |
| [mem0](https://github.com/mem0ai/mem0) | Apache-2.0 | **Adapt** — extraction pipeline; store is per-app, not cross-tool |
| [Letta](https://github.com/letta-ai/letta) | Apache-2.0 | **Adapt** — real persistence model for stateful agents |
| [LanceDB](https://github.com/lancedb/lancedb) | Apache-2.0 | **Reuse** — *embedded* vectors; matches SQLite-first, no-server constraint |
| [Qdrant](https://github.com/qdrant/qdrant) / [Chroma](https://github.com/chroma-core/chroma) | Apache-2.0 | **Integrate** for the Postgres track; **ignore** for the 12h MVP |
| [LlamaIndexTS](https://github.com/run-llama/LlamaIndexTS) | MIT | **⚠ Ignore — `archived: true`** |

### 1.6 LLM abstraction / routing
| Name | License | Recommendation |
|---|---|---|
| [Vercel AI SDK](https://github.com/vercel/ai) | Apache-2.0 | **Reuse** — first-class TS, provider-agnostic, structured output + tool calls |
| [LiteLLM](https://github.com/BerriAI/litellm) | MIT + separate `enterprise/` terms | **Integrate** — unmatched routing/fallback; never copy `enterprise/` |
| [Portkey Gateway](https://github.com/Portkey-AI/gateway) | MIT | **Integrate** as optional sidecar |
| [ollama-js](https://github.com/ollama/ollama-js) | MIT | **Reuse** — local-model client |
| [LangChain.js](https://github.com/langchain-ai/langchainjs) | MIT | **Ignore** — abstraction weight we don't need |

### 1.7 Evaluation / LLM-as-judge
| Name | License | Recommendation |
|---|---|---|
| [Promptfoo](https://github.com/promptfoo/promptfoo) | MIT | **Reuse** — declarative assertions; ideal judge layer *and* evidence output |
| [DeepEval](https://github.com/confident-ai/deepeval) | Apache-2.0 | **Adapt** — pytest-style metrics (Python sidecar) |
| [Inspect](https://github.com/UKGovernmentBEIS/inspect_ai) | MIT | **Adapt** — best evidence-emitting eval design to imitate |
| [Ragas](https://github.com/vibrantlabsai/ragas) | Apache-2.0 | **Adapt** only if retrieval quality becomes a metric |
| [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) | MIT | **Ignore** — model benchmarking, not repo-change verification |
| [OpenAI Evals](https://github.com/openai/evals) | **UNVERIFIED** (rate-limited) | **Ignore pending verification** |

### 1.8 Git checkpoint / rollback
| Name | License | Recommendation |
|---|---|---|
| [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) | MIT | **Reuse** — pure-JS git; create/restore checkpoints without shelling out |
| [Jujutsu](https://github.com/jj-vcs/jj) | Apache-2.0 | **Adapt** — operation-log + undo is the right mental model for reversible checkpoints |
| [gitoxide](https://github.com/GitoxideLabs/gitoxide) | Apache-2.0 (dual MIT/Apache) | **Ignore** — Rust, wrong runtime |
| [libgit2](https://github.com/libgit2/libgit2) | **GPLv2 + linking exception** ([COPYING](https://raw.githubusercontent.com/libgit2/libgit2/main/COPYING)) | **⚠ Flag copyleft** — get counsel to scope the exception before shipping |
| [GitButler](https://github.com/gitbutlerapp/gitbutler) | **FSL-1.1-MIT** ([LICENSE.md](https://raw.githubusercontent.com/gitbutlerapp/gitbutler/main/LICENSE.md)) | **⚠ Flag FSL** — source-available, not OSI; study, copy nothing |

**Cheapest correct design:** Cline's shadow-repo — a *separate* git repo, commit after every mutating tool call, snapshot untracked/ignored files, restore to any point. Cline's own docs describe this; Claude Code's docs concede bash-made changes aren't tracked at all.

### 1.9 Observability & tracing
| Name | License | Recommendation |
|---|---|---|
| [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 | **Reuse** — one span per verification layer; vendor-neutral |
| [OpenLLMetry](https://github.com/traceloop/openllmetry) | Apache-2.0 | **Integrate** — GenAI semantic conventions on OTel |
| [Opik](https://github.com/comet-ml/opik) | Apache-2.0 | **Integrate** — open trace+eval UI |
| [Langfuse](https://github.com/langfuse/langfuse) | MIT core + `ee/` under separate terms | **Integrate** — avoid the `ee/` directories |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | **Elastic License 2.0** | **⚠ Flag ELv2** — not OSI-approved |

### 1.10 Local runtimes
[Ollama](https://github.com/ollama/ollama) **MIT** (182,183★) → **Reuse**, primary. [MLX](https://github.com/ml-explore/mlx) **MIT** (28,649★) → **Integrate**, best perf/GB on M4. [llama.cpp](https://github.com/ggml-org/llama.cpp) **MIT** → **Integrate** as fallback. [vLLM](https://github.com/vllm-project/vllm), [LocalAI](https://github.com/mudler/LocalAI), [llamafile](https://github.com/mozilla-ai/llamafile) → **Ignore** (GPU/server-class or redundant).

### 1.11 Benchmarks
[SWE-bench](https://github.com/SWE-bench/SWE-bench) **MIT** (5,969★, PUSHED 2026-09-18) → **Integrate** for public credibility. [Terminal-Bench](https://github.com/harbor-framework/terminal-bench-1) **Apache-2.0** → **Integrate**; closest to "did it actually work". [EvalPlus](https://github.com/evalplus/evalplus) **Apache-2.0** → **Adapt**. [BigCode harness](https://github.com/bigcode-project/bigcode-evaluation-harness) → **UNVERIFIED**.

---

## 2. Competitor check

**Claude Code** ([checkpointing](https://code.claude.com/docs/en/checkpointing)) — terminal agent with hooks, subagents, MCP, `CLAUDE.md` context and real checkpoint/rewind. **(a) NO** cross-tool — context is Claude-Code-specific. **(b) NO** — rewind is user-initiated, tracks only its own edits, and the docs concede "Bash command changes not tracked", "Subagent edits not restored", "Not a replacement for version control". **(c) NO** documented signed artifact.

**OpenAI Codex** ([repo](https://github.com/openai/codex)) — Apache-2.0 CLI/cloud agent, very active; state is per-session/per-repo. **(a) NO. (b) NO/UNVERIFIED** — self-corrects, but no documented automatic revert on evaluation failure. **(c) NO.**

**Cursor** ([agent docs](https://cursor.com/help/ai-features/agent.md)) — IDE agent with rules and subagents. **(a) PARTIAL** — **conversation search** lets Agent "query your past conversations on its own", so persistence is real but Cursor-cloud-scoped and not exportable. **(b) NO** — "Restore Checkpoint" "reverts files only", and a human presses it, not a failing test. **(c) NO.**

**Cline** ([checkpoints](https://docs.cline.bot/core-workflows/checkpoints)) — Apache-2.0; strongest checkpoint story of the group: a shadow git repo committing after each tool use, persisting across editor sessions. But **(a) NO** cross-tool, **(b) NO** automatic (a button, not a test result), **(c) NO.**

**Roo Code** ([repo](https://github.com/RooCodeInc/Roo-Code)) — GitHub reports **`archived: true`** on 2026-10-04 (PUSHED 2026-05-15); third-party coverage frames it as [shut down versus actively built Kilo Code](https://theaiagentindex.com/compare/roo-code-vs-kilo-code). **(a)/(b)/(c) NO** — dead. Successor [Kilo Code](https://github.com/Kilo-Org/kilocode) (MIT) inherits the same gaps.

**Aider** ([git docs](https://aider.chat/docs/git.html)) — auto-commits **every** edit, commits pre-existing dirty files first, `/undo` reverts: genuinely per-edit transactional. **(a) NO. (b) PARTIAL** — rollback primitives exist but the *decision* is human; commits are for attribution, not gated on evaluation. **(c) NO** — the `(aider)` author trailer is attribution, not tamper-evidence.

**OpenCode** ([repo](https://github.com/anomalyco/opencode)) — MIT terminal agent; session-scoped context, manual undo. **(a)/(b)/(c) NO.** **Goose** ([repo](https://github.com/aaif-goose/goose)) — Apache-2.0, MCP-native; recipes give reusable *workflows*, not durable project state. **(a)/(b)/(c) NO.**

**Devin / Devin Desktop** ([devin.ai](https://devin.ai)) — Cognition rebranded Windsurf (ex-Codeium) to Devin Desktop in June 2026, and per a [July 2026 vendor write-up](https://raw.githubusercontent.com/vectorize-io/hindsight/322bd02c6ae77f63c3501b8015e00d948a0c9fda/hindsight-docs/blog/2026-07-02-devin-desktop-persistent-memory.md) it "has no built-in memory across sessions" — persistence needs a third-party MCP memory server. *Caveat: that source sells exactly that integration, so the framing is self-interested; the claim is specific and falsifiable.* **(a) NO** natively. **(b)/(c) NO.**

**Continue** ([repo](https://github.com/continuedev/continue)) — rules/prompts-as-config, checked into git, so conventions travel. **(a) PARTIAL** (a versioned config file is a weak project world). **(b)/(c) NO.**

**OpenHands** ([repo](https://github.com/OpenHands/OpenHands)) — MIT; event stream, sandbox, memory module, microagents ([PR #8122](https://github.com/OpenHands/OpenHands/pull/8122)). Closest competitor to Attest's runtime thesis. **(a) PARTIAL** — memory is session-scoped, not a portable project artifact. **(b) NO** documented auto-rollback on failed eval. **(c) NO.**

**SWE-agent** ([repo](https://github.com/SWE-agent/SWE-agent)) — MIT research harness optimising benchmark pass-rate; explicitly not a product runtime. **(a)/(b)/(c) NO.**

### Differentiator

The honest version: **(a) and (c) are weak moats; (b) is the real one.** Every serious agent already persists *something* — CLAUDE.md, `.cursor/rules`, Cline's shadow repo, OpenHands' event stream — so "persistent project world" is positioning, not defensibility, and it stays weak until our world is a *versioned, tool-agnostic artifact in the repo* that Claude Code, Codex and Cursor all read and write over MCP; only then is it a hub rather than a competitor. Likewise, "tamper-evident evidence records" is a weekend of work for the Cline team — a hash-chained signed JSON is a feature, not a moat, and its only durable value is becoming the format others adopt. The genuinely uncontested gap is that **nothing closes the loop: run N verification layers → on failure diagnose → automatically roll back to the last known-good checkpoint → attempt repair → record why the surviving change is trusted.** Cline has checkpoints but no trigger; Aider has commits but no gate; Cursor and Claude Code have rewind but a human presses it; SWE-agent has the loop but no reversibility. Attest's sharpest wedge is therefore **eval-gated auto-rollback with repair as one unattended transaction**, plus a quieter second one: doing it on local open-weight models at zero marginal cost, which hosted competitors structurally cannot match. If we ship only the Project World and the evidence format and skip the automatic rollback-and-repair transaction, we will have built a nice dashboard that Cline subsumes in one release.

---

## 3. Open-weight model fit for local M4 / 16GB RAM

Tags, sizes and contexts read from `ollama.com/library/<model>/tags` on 2026-10-04. **"RAM need" is our engineering estimate, not a vendor figure** (≈ weights + KV cache); on 16GB unified memory, treat >~11GB of weights as swap-prone. "Tools" = Ollama's own capability badge for that tag.

| Ollama tag | Download | RAM (est.) | Context | License | Tools | Verdict |
|---|---|---|---|---|---|---|
| [`qwen3.5:4b`](https://ollama.com/library/qwen3.5/tags) | 3.3–4.0 GB | ~5 GB | 256K | **Apache-2.0** ([card](https://huggingface.co/api/models/Qwen/Qwen3.5-4B)) | **Yes**+thinking | **Best default** — newest family, fast |
| [`qwen3.5:9b`](https://ollama.com/library/qwen3.5/tags) | 6.6–7.6 GB | ~9 GB | 256K | **Apache-2.0** ([card](https://huggingface.co/api/models/Qwen/Qwen3.5-9B)) | **Yes**+thinking | **Best quality that fits** |
| [`qwen2.5-coder:7b`](https://ollama.com/library/qwen2.5-coder/tags) | 4.7 GB | ~6 GB | 32K | **Apache-2.0** ([card](https://huggingface.co/api/models/Qwen/Qwen2.5-Coder-7B-Instruct)) | **Yes** | **Reuse** — proven code specialist |
| [`qwen2.5-coder:14b`](https://ollama.com/library/qwen2.5-coder/tags) | 9.0 GB | ~11 GB | 32K | **Apache-2.0** ([card](https://huggingface.co/api/models/Qwen/Qwen2.5-Coder-14B-Instruct)) | **Yes** | Strongest specialist that fits; tight |
| [`gemma4:e2b`](https://ollama.com/library/gemma4/tags) | 4.6–7.5 GB | ~8 GB | 128K | **Apache-2.0** ([card](https://huggingface.co/api/models/google/gemma-4-E2B-it)) | **Yes**+thinking+vision | **Adapt — best-licensed new option** |
| [`gemma4:e4b`](https://ollama.com/library/gemma4/tags) | 6.6–9.5 GB | ~10 GB | 128K | **Apache-2.0** ([card](https://huggingface.co/api/models/google/gemma-4-E4B-it)) | **Yes**+thinking+vision | Same; `e2b` preferred at 16GB |
| [`qwen3:4b`](https://ollama.com/library/qwen3/tags) | 2.5 GB | ~4 GB | 256K | **Apache-2.0** ([card](https://huggingface.co/api/models/Qwen/Qwen3-4B-Instruct-2507)) | **Yes**+thinking | Fallback if Qwen3.5 is unstable |
| [`granite4:micro-h`](https://ollama.com/library/granite4/tags) | 1.9 GB | ~3 GB | **1M** | **Apache-2.0** ([card](https://huggingface.co/api/models/ibm-granite/granite-4.0-micro)) | **Yes** | **Reuse** — tiny tool-capable router/classifier |
| [`llama3.2:3b`](https://ollama.com/library/llama3.2/tags) | 2.0 GB | ~3 GB | 128K | Llama 3.2 Community (custom) | **Yes** | Integrate — fine for cheap steps; not OSI |
| [`gemma3:4b`](https://ollama.com/library/gemma3/tags) | 3.3 GB | ~5 GB | 128K | Gemma Terms (custom) | **No badge** | **Ignore** — superseded by `gemma4:e2b` |
| [`phi4:14b`](https://ollama.com/library/phi4/tags) | 9.1 GB | ~11 GB | **16K** | **MIT** ([card](https://huggingface.co/api/models/microsoft/phi-4)) | **No badge** | Ignore for agent loops — permissive but no tools, tiny context |
| [`gpt-oss:20b`](https://ollama.com/library/gpt-oss/tags) | **14 GB** | ~16 GB+ | 128K | **Apache-2.0** ([card](https://huggingface.co/api/models/openai/gpt-oss-20b)) | **Yes**+thinking | **⚠ Not local on 16GB** — use a hosted open-weight endpoint |
| [`deepseek-coder:6.7b`](https://ollama.com/library/deepseek-coder/tags) | 3.8 GB | ~5 GB | 16K | DeepSeek license ("other") | **No badge** | Ignore — 2024-era, no tool calling |
| [`codestral:22b`](https://ollama.com/library/codestral/tags) | **13 GB** | ~15 GB+ | 32K | **MNPL** ("other") | **No badge** | **⚠ Ignore** — too big *and* non-production license |
| [`qwen3-coder:30b`](https://ollama.com/library/qwen3-coder/tags) | **19 GB** | ~21 GB | 256K | Apache-2.0 | **Yes** | **⚠ Too big for 16GB** — hosted only |

**Recommended stack:** `qwen3.5:4b` resident as orchestrator, `qwen2.5-coder:7b` or `qwen3.5:9b` for codegen, `granite4:micro-h` for routing, `gpt-oss:20b` hosted for hard repair. **Correction worth noting:** `gemma3` has *no* `tools` badge, but **Gemma 4 is Apache-2.0 with `tools`** — a material upgrade over the brief's assumption. Ollama also ships **MLX tags** for Apple Silicon ([`gemma4:e2b-mlx`](https://ollama.com/library/gemma4/tags), [`qwen3.5:2b-mlx`](https://ollama.com/library/qwen3.5/tags)); prefer these on the M4.

---

## 4. Honest risks (top 5)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **The auto-rollback loop is the product and the hardest part.** Detect→diagnose→revert→repair→re-verify is a state machine; half-built it is worse than Cline's manual Restore. | Freeze scope: **one** verification stack (typecheck + unit) and **one** retry, driven by an explicit state machine persisted in SQLite so an interrupted run resumes. Demo only the happy path. |
| 2 | **Local tool-calling is unreliable at 4–9B.** Malformed/hallucinated calls look like *our* bug on stage, killing the open-weight story. | JSON-Schema-validate every tool call, one tool per turn, retry with error feedback, hosted open-weight fallback behind the same router. Log every malformed call — that log is a selling point. |
| 3 | **Checkpoint correctness across dirty/untracked state.** Claude Code's docs concede bash-made changes aren't tracked and subagent edits aren't restored. | Shadow git repo, commit after every mutating tool call, snapshot untracked+ignored files, and **refuse to run** if the tree is dirty beyond our own checkpoint. Test against a dirty repo. |
| 4 | **"Evidence record" scope creep.** Hash chains and PKI can eat 6 hours with no loop shipped. | Ship `{task, checkpoint before/after, commands, raw outputs, verdicts, model+version, sha256 chain}` plus `attest verify`. **No signing keys.** Say "attestation", not "notarization". |
| 5 | **The Next.js control center eats the clock** and is not the differentiator. | CLI-first; the web center reads the same SQLite file and renders **two** views (Project World, Evidence). Ship the UI last, only if the loop is green. |

**Biggest single risk: #2.** Risks 1, 3, 4 and 5 are engineering we control; #2 is a property of the models. If 4–9B models cannot reliably drive the tool loop, the "open-source AI at its core" thesis fails *at the demo* regardless of how good the checkpointing is. Mitigate by making the model layer swappable on day one and validating the loop against a hosted open-weight model before optimising for local.

**License hygiene:** never copy from SSPL (Inngest), BSL (Restate), AGPL (Windmill), FSL (GitButler), ELv2 (Phoenix), GPL-with-exception (libgit2), MNPL (Codestral), or the `ee/`/`enterprise/` dirs of Langfuse and LiteLLM. Anything marked **integrate** must run as a separate process or network call, so no incompatible code enters our tree.
