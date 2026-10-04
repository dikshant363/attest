# Sponsor Integration Matrix — Attest (Hacktoberfest Weekend Challenge 2026)

**Prepared:** 2026-10-04 · **Deadline:** 2026-10-05 06:59 UTC (12:29 IST) — ~12h left
**Sources:** [challenge post](https://dev.to/devteam/join-the-hacktoberfest-weekend-challenge-build-for-a-friend-2450-in-prizes-across-17-winners-1aj5) · [challenge page](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01) · [HF26 hub](https://dev.to/challenges/hf26) · [contest rules](https://dev.to/page/official-hackathon-rules) · [FAQ](https://hacktoberfest.com/questions/)
**Verified locally:** `ollama 0.35.1`, `node v22.23.2`, `pnpm 11.22.0`. `temporal` CLI **not installed** (Homebrew formula 1.9.1 available).

---

## Part A — Scoring Matrix

| Category | What the docs actually require | Free tier / credits | Fit for Attest | <2h? | Demo value | RECOMMEND | Conf. |
|---|---|---|---|---|---|---|---|
| **Gemma** (feat.) | "Use Gemma… run it locally, fine-tune it, or serve it" ([hub](https://dev.to/challenges/hf26)) | Free; Apache 2.0 weights, $0 inference | **High** — it *is* our inference layer | **Yes** | High: offline, $0/token | **ENTER** | High |
| **Sentry Agent Tracing** (partner) | "Show your agent's work… latency, tokens, cost… **Include traces or screenshots**" ([hub](https://dev.to/challenges/hf26)) | Free Developer plan, forever ([pricing](https://sentry.io/pricing/)) | **High** — we must emit evidence anyway | **Yes** | High: Agents dashboard shot | **ENTER** | High |
| **Temporal** (partner) | "Wrap it in a Temporal workflow so it survives failures, retries flaky tool calls, and picks up where it left off" ([hub](https://dev.to/challenges/hf26)) | Cloud $150/90d, **card required**; local dev server free ([pricing](https://temporal.io/pricing.md)) | **High** — checkpoint/rollback is our thesis | **No** — 4h+ | High: replay-after-kill | **STRETCH** | High |
| **Tiger Data** (partner) | "Store embeddings with pgvector, run hybrid keyword and vector search…" ([hub](https://dev.to/challenges/hf26)) | "$1000-credit, 30-day free trial" ([docs](https://www.tigerdata.com/docs/get-started/quickstart/create-account)) | **High** — world memory + retrieval | Yes via CLI/MCP | Med-High: hybrid memory search | **STRETCH** | Med |
| **Render** (feat.) | "Use Render… to host an agent's front end" ([hub](https://dev.to/challenges/hf26)) | Free web services/static; 750 instance-hrs/mo ([docs](https://render.com/docs/free.md)) | **High** — Next.js UI needs hosting | **Yes** | High: public URL for judges | **ENTER** | High |
| **MongoDB Atlas** (partner) | "Atlas Vector Search for retrieval, long-term memory for an agent" ([hub](https://dev.to/challenges/hf26)) | Free M0 ([register](https://www.mongodb.com/cloud/atlas/register)) | Med — same slot as Tiger Data | Yes | Med: needs seed data | SKIP (one of {Atlas,Tiger}) | Med |
| **GitHub Copilot** (partner) | "Copilot's coding agent, the Copilot CLI… or review PRs" ([hub](https://dev.to/challenges/hf26)) | Paid; no free agent tier ([docs](https://docs.github.com/copilot)) | **Low** — dev tool, not a runtime dep | — | Low | **SKIP** | High |
| **Mastra** (partner) | "Orchestrate an agent over open models, add memory and tools" ([hub](https://dev.to/challenges/hf26)) | OSS free (`@mastra/core` 1.74.0) ([docs](https://mastra.ai/docs.md)) | **Low** — duplicates our runtime; forces core rewrite | No | Low | **SKIP** | High |
| **DigitalOcean** (feat.) | "Host your app or agent, run an open-weight model on a GPU Droplet, or build on Gradient AI" ([hub](https://dev.to/challenges/hf26)) | UNVERIFIED | Med — hosting only, duplicates Render | Yes | Low | SKIP | Med |
| **SerpApi** (partner) | "Give an agent live web search, ground a RAG app in fresh results" ([hub](https://dev.to/challenges/hf26)) | UNVERIFIED ([API](https://serpapi.com/search-api)) | **Low** — Attest works on a local repo | No | Low | **SKIP** | Med |
| **TabPFN** (partner) | "Forecast, predict, classify, or spot anomalies from… a CSV" ([docs](https://docs.priorlabs.ai/api-reference/getting-started)) | UNVERIFIED | **Low** — no tabular ML in Attest | No | Low: prize-chase | **SKIP** | Med |
| **Tinker** (feat.) | "Fine-tune a model… and show a clear improvement… over a baseline" ([docs](https://tinker-docs.thinkingmachines.ai/)) | Credits ([challenge page](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)) | **Low** — needs pre/post eval we lack | **No** | Med if real | **SKIP** | Med |
| **Entire** (partner) | Share agent sessions in the write-up, or search past agent work ([docs](https://docs.entire.io)) | UNVERIFIED (host redirects) | **Low** — narrative, not architecture | Maybe | Med: write-up only | **SKIP** | Low |
| **ElevenLabs** (partner) | "Give an open-source agent a voice… or generate narration for your demo" ([docs](https://elevenlabs.io/docs)) | Credits ([challenge page](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)) | **Low** — Attest is a CLI runtime, not voice | Yes | Med: narration only | **SKIP** | High |
| **Arduino** (feat.) | "Build with an Arduino UNO Q: run a model on the board" ([docs](https://docs.arduino.cc)) | Hardware required | **Low** — no board, no hardware time | No | — | **SKIP** | High |
| **Backboard** (partner) | "Build with R-CLI, Backboard's open-source terminal coding agent…" ([hackathons](https://backboard.io/hackathons)) | Credits ([challenge page](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)) | **Low-Med** — a competing coding agent | No | Med | SKIP | Low |

### High / Med fit — the concrete integration

**Gemma — High.** Not an add-on: Attest's "local open-weight model" claim *is* Gemma on `localhost:11434`. Gemma 4 is **Apache 2.0** ([license](https://ai.google.dev/gemma/apache_2)), so shipping weights and fine-tunes needs no custom-license review.

**Sentry Agent Tracing — High.** Attest's differentiator is emitting *evidence*; Sentry is its transport. One `gen_ai.invoke_agent` span per repair run, `gen_ai.chat` per model call, `gen_ai.execute_tool` per checkpoint/test/rollback. We call Ollama directly, so SDK ≥11.0.0 auto-instrumentation does **not** cover us — [manual instrumentation](https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/manual-instrumentation/) is required. More work, but genuinely ours.

**Temporal — High fit, Low budget fit.** The match is exact: Attest already has checkpoints, rollback, repair. But durable execution means splitting the loop into deterministic Workflows plus side-effecting Activities, where a Workflow cannot read the clock or filesystem. That refactor costs 4h+ of a 12h budget.

**Tiger Data — High fit, medium cost.** pgvector + BM25 hybrid search ([tutorial](https://www.tigerdata.com/docs/learn/tutorials/hybrid-search), [concepts](https://www.tigerdata.com/docs/learn/search/key-vector-database-concepts-for-understanding-pgvector)) gives "what did we try before, and what failed" retrieval. The Tiger CLI/MCP path ([cli](https://www.tigerdata.com/docs/get-started/quickstart/tiger-cli), [mcp](https://www.tigerdata.com/docs/get-started/quickstart/mcp-cli)) is fastest, but competes with Atlas for the same single slot.

**Render — High.** A public URL for the Next.js UI is required for a credible demo ([free docs](https://render.com/docs/free.md)).

### Prize-chasing — SKIP explicitly

**Arduino, TabPFN, ElevenLabs, SerpApi, GitHub Copilot, Mastra, Tinker** do not belong in Attest's architecture. Arduino needs hardware we lack. TabPFN solves tabular ML, which Attest never does. ElevenLabs would only narrate the video — an agent whose "voice" never appears in its workflow is the textbook superficial integration. SerpApi adds web search to an agent that works on a local repo. Copilot and Mastra are the tools Attest *replaces*; using them undercuts our core claim. Tinker needs a pre/post fine-tune result we cannot produce honestly now.

---

## Part B — Deep dives: minimum viable integration

### 1. Gemma (featured, $200)

**Serve locally.** The official guide ([Ollama integration](https://ai.google.dev/gemma/docs/integrations/ollama)) prescribes `ollama pull gemma4` for the default variant.

```
ollama pull gemma4:e4b            # smallest practical local default
ollama pull gemma4:12b-it-qat     # better reasoning, quantized
ollama pull gemma4:31b-it-qat     # best quality if RAM allows
curl http://localhost:11434/api/generate -d '{"model":"gemma4","prompt":"roses are red"}'
```

Documented sizes: **E2B, E4B, 26B-A4B, 31B** (guide); the [tag page](https://ollama.com/library/gemma4/tags) adds **12B** (`12b-it-qat`, `12b-mlx-bf16`, `12b-nvfp4`, `12b-mxfp8`). Legacy [gemma3 tags](https://ollama.com/library/gemma3/tags): `270m, 1b, 4b, 12b, 27b` + `-it-qat / -it-q4_K_M / -it-q8_0 / -it-fp16`.

**License.** Gemma **4** is **Apache 2.0** ([license](https://ai.google.dev/gemma/apache_2)); Gemma **3 and earlier** use the custom [Gemma Terms of Use](https://ai.google.dev/gemma/terms) (see [Gemma 3 model card](https://ai.google.dev/gemma/docs/core/model_card_3)). **Use Gemma 4.**

**Tool calling / structured output.** Gemma **4** supports function calling, but not via a native tools API: schemas go in through `apply_chat_template(..., tools=[...])` and the model emits `<|tool_call>call:fn{args}<tool_call|>`, which **we must regex-parse** — "Gemma cannot execute code on its own" ([function calling guide](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)). Thinking mode (`enable_thinking=True`) measurably improves tool-call accuracy. Native JSON-Schema-constrained decoding is **UNVERIFIED** — not documented. `FunctionGemma` is a separate variant ([overview](https://ai.google.dev/gemma/docs/functiongemma)).

### 2. Sentry Agent Tracing (partner, $100)

**Package & setup.** `@sentry/node` (npm latest **11.4.0**). SDK ≥11.0.0 auto-instruments a fixed list — OpenAI, Anthropic, Google Gen AI, LangChain, LangGraph, Vercel AI SDK, Mastra, Groq, Mistral, Together, Cloudflare, Eve, Flue ([Node agent tracing](https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/)). **Ollama is not on it** → manual spans.

**What it captures.** `gen_ai.invoke_agent` → `gen_ai.chat` (per model call) + `gen_ai.execute_tool` (per tool run); tokens via `gen_ai.usage.input_tokens`/`output_tokens`; cost from `gen_ai.request.model` + tokens against [models.dev](https://models.dev)/[OpenRouter](https://openrouter.ai) pricing ([Model Costs](https://docs.sentry.io/product/agents/costs/)). Group turns with `Sentry.setConversationId("conv_abc123")`.

**Cost caveat:** an unknown model name yields computed cost **zero**. For a local model, pass the real `$0` via `gen_ai.cost.total_tokens` and frame it as token accounting showing what a closed API would have cost.

**Free tier.** Developer plan: **1 user, 5k errors, 5M spans, 5GB logs, 50 replays, 30-day lookback, agent tracing included** ([pricing](https://sentry.io/pricing/)).

### 3. Temporal (partner, $100)

**Durable agent minimum.** Node.js ≥20; `npm install @temporalio/client @temporalio/worker @temporalio/workflow` (npm latest **1.24.0**); scaffold with `npx @temporalio/create@latest ./my-app` ([TypeScript local setup](https://docs.temporal.io/develop/typescript/set-up-your-local-typescript)). Workflows are deterministic; each LLM/tool/test call becomes an **Activity** with automatic retry + backoff. TS recipe: [durable agent with tools via the AI SDK](https://docs.temporal.io/ai/cookbook/ai-sdk-by-vercel-typescript).

**Dev server.** `brew install temporal` then **`temporal server start-dev`** — localhost:7233, UI at localhost:8233 ([setup guide](https://docs.temporal.io/develop/typescript/set-up-your-local-typescript)). No card, no account.

**Cloud free tier.** From **$0/mo**, **$150 credits expiring in 90 days**, **$50 per million Actions**; **a credit card is required to sign up for Temporal Cloud** ([pricing](https://temporal.io/pricing.md)).

**Honest verdict:** the *replay-after-kill* demo — kill the worker mid-repair, restart, watch it resume — is the best proof of Attest's thesis, but it is **not** a <2h integration. Enter only if one engineer gets 4 focused hours, scoped to one Workflow with one Activity.

### 4. Tiger Data (partner, $100)

**pgvector / hybrid search.** Tiger Cloud is managed Postgres with pgvector + `pgvectorscale` and `pg_textsearch`/BM25: [BM25 + vector hybrid search tutorial](https://www.tigerdata.com/docs/learn/tutorials/hybrid-search), [production RAG tutorial](https://www.tigerdata.com/docs/learn/tutorials/rag-postgres), [pgvector concepts](https://www.tigerdata.com/docs/learn/search/pgvector-pgvectorsearch). Fast paths: [Tiger CLI](https://www.tigerdata.com/docs/get-started/quickstart/tiger-cli), [Tiger MCP](https://www.tigerdata.com/docs/get-started/quickstart/mcp-cli).

**Free tier / card.** Signup gives a **"$1000-credit, 30-day free trial"** ([create account](https://www.tigerdata.com/docs/get-started/quickstart/create-account)). Credit-card capture is **UNVERIFIED** — the page does not say. (The AWS/Azure Marketplace route explicitly requires a valid payment method; not the same claim.)

---

## Part C — Recommended integration set (3)

Enter **exactly three**:

**1. Gemma — inference layer** (featured, $200)
- **First command:** `ollama pull gemma4:e4b` → `ollama run gemma4:e4b "reply with the word ready"` ([guide](https://ai.google.dev/gemma/docs/integrations/ollama))
- **Acceptance test:** `curl -s http://localhost:11434/api/generate -d '{"model":"gemma4:e4b","prompt":"ready"}'` returns generated text **with Wi-Fi off**, and one full checkpoint → test → rollback cycle completes with no network.
- **Risk:** model size vs. laptop RAM. `e4b` is safe; `31b` may swap and wreck the live demo. Choose deliberately and say so in the write-up.

**2. Sentry Agent Tracing — evidence layer** (partner, $100)
- **First call:** `pnpm add @sentry/node`, then `Sentry.init({ dsn, tracesSampleRate: 1.0, dataCollection: { genAI: { inputs: false, outputs: false } } })`, then wrap a repair run in `Sentry.startSpan({ op: "gen_ai.invoke_agent", name: "invoke_agent Attest" }, ...)`
- **Acceptance test:** run one repair, open **Explore → Agents**, see `invoke_agent Attest` with ≥2 `gen_ai.chat` children, ≥1 `gen_ai.execute_tool` child, and non-zero `gen_ai.usage.input_tokens`/`output_tokens`. Screenshot it — the challenge page explicitly asks for traces or screenshots.
- **Risk:** no auto-instrumentation for Ollama, so span nesting is on us. Validate the hierarchy with a trivial two-call script *before* wiring it into the agent loop; a broken hierarchy shows an empty dashboard.

**3. Render — delivery layer** (featured, $200)
- **First command:** `brew install render` → `render login` → `render services list -o json` ([CLI docs](https://render.com/docs/cli.md)); or connect the monorepo and pick the **Free** compute plan ([free docs](https://render.com/docs/free.md))
- **Acceptance test:** the UI is reachable at a public `onrender.com` URL and an Attest run can be triggered from the browser end-to-end.
- **Risk:** free web services **spin down after 15 idle minutes and take ~1 minute to wake** ([free docs](https://render.com/docs/free.md)). Warm the service immediately before recording; never demo a cold URL.

**Runner-up if a 4th slot appears:** MongoDB Atlas M0 *or* Tiger Data for world memory — pick **one**, never both. **Deliberate non-entry:** Temporal gets a paragraph as designed-but-not-shipped; an honest "here's what we'd add next, and the exact API" beats a half-wired durable workflow.

---

## Part D — What the official rules constrain

**Multiple categories do NOT need multiple posts.** *"One project can enter every category it genuinely uses, but you can win once per challenge"* ([challenge page](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01), [hub](https://dev.to/challenges/hf26)). One submission is automatically considered for the overall prize and *every* category it qualifies for ([announcement](https://dev.to/devteam/hacktoberfest-2026-dev-challenges-five-challenges-one-prompt-a-new-theme-every-week-1e54)). The submission template has an explicit **"Prize Categories"** section: *"List every one that applies."*

**Proof of use is category-specific.** **Sentry requires it**: *"Include traces or screenshots in your write-up"* ([hub](https://dev.to/challenges/hf26)). No other category page mandates screenshots, but the [Official Contest Rules](https://dev.to/page/official-hackathon-rules) §ENTRY REQUIREMENTS let the announcement page set minimum elements, and judging asks whether the tech is used *meaningfully*. No category asks for API keys or billing proof.

**Other hard constraints:**
- Rules require that *"development of your Entry was started during, and not prior to, the Entry Period"* — pre-existing Attest scaffolding is a disqualification risk; the write-up should date the work inside the window.
- **18+** and not resident in the excluded jurisdictions (Afghanistan, Belarus, CAR, Cuba, Equatorial Guinea, Iran, Iraq, Kosovo, Libya, Myanmar, North Korea, Russia, South Sudan, Sudan, Syria, Tanzania, Venezuela, Yemen).
- **Writing Quality is weighted most heavily**; "Use of Partner Technology" is optional. A great build with a thin post loses.
- Winners may need an affidavit of eligibility plus tax info within 7 business days.
- The [FAQ](https://hacktoberfest.com/questions/) confirms DEV Challenges follow DEV's own rules rather than Hacktoberfest Fest rules, and that linking a DEV account to My Hacktoberfest is what awards badges.

---

## UNVERIFIED (do not repeat as fact)

1. **Tiger Data credit-card requirement at signup** — a $1000/30-day trial is documented; card capture is not stated.
2. **DigitalOcean credit amount** — the credit list names only Tinker, Render, Backboard, ElevenLabs ([challenge page](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)).
3. **TabPFN / SerpApi / Backboard / Entire / ElevenLabs free-tier limits** — docs hosts did not render (Entire's docs host cross-origin redirects).
4. **Gemma 4 native JSON-Schema-constrained decoding** — only tool-call parsing is documented.
5. **MongoDB Atlas M0 limits** — free-cluster doc page returned no usable body text.
6. **`@temporalio/*` @ 1.24.0** — verified against the npm registry, not the docs page text.
