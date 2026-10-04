# RECONNAISSANCE.md

**Captured:** 2026-10-04T17:25Z (22:55 IST) · **Author:** Lead agent
**Method:** direct environment inspection + official challenge sources. Every claim below is either measured locally or linked.

---

## 1. The single most important finding

The original product brief assumed a generic "autonomous engineering runtime" submission. **The official
Hacktoberfest 2026 Weekend Challenge requires something different, and the difference is decisive.**

| Assumption in brief | Verified reality | Source |
|---|---|---|
| Build any new project with open-source AI at its core | Correct, **but** the Weekend Challenge theme is **"Build for a Friend"** — one real person, a real problem they have | [Official challenge post](https://dev.to/devteam/join-the-hacktoberfest-weekend-challenge-build-for-a-friend-2450-in-prizes-across-17-winners-1aj5) |
| Plenty of runway | **Submissions due 2026-10-05 06:59 UTC** — ~13.5 h from reconnaissance | [Challenge post · Important Dates](https://dev.to/devteam/join-the-hacktoberfest-weekend-challenge-build-for-a-friend-2450-in-prizes-across-17-winners-1aj5) |
| Judge technical execution | **Writing quality is weighted most heavily**; technical execution is one of five criteria | [Judging criteria](https://dev.to/devteam/join-the-hacktoberfest-weekend-challenge-build-for-a-friend-2450-in-prizes-across-17-winners-1aj5) |
| Ship a repo / PR | **The submission artifact is a DEV.to blog post.** No PR-count Hacktoberfest this year | [Five challenges post](https://dev.to/devteam/hacktoberfest-2026-dev-challenges-five-challenges-one-prompt-a-new-theme-every-week-1e54) |
| Optional extras | "Bonus points if you actually hand it over and tell us what they said" | [Challenge post](https://dev.to/devteam/join-the-hacktoberfest-weekend-challenge-build-for-a-friend-2450-in-prizes-across-17-winners-1aj5) |

**Consequence:** the engineering-runtime thesis survives, but only when anchored to one named developer
and their concrete pain. It has been re-anchored accordingly — see `DECISION.md`.
A code-only, story-less submission would score poorly regardless of technical quality.

---

## 2. Environment (measured, not assumed)

```
Host            Apple M4, 10 cores
RAM             16 GB          <- hard constraint on local model size
Free disk       96 GB
OS              macOS (Darwin 25.x)
Node            v22.23.2       (also bundled: DSH runtime node)
pnpm            11.22.0
npm             10.9.8
Python          3.12.14
Git             2.55.0
GitHub CLI      2.97.0
Docker          29.4.0
Homebrew         present (/opt/homebrew)
```

### Network reachability

| Host | Result |
|---|---|
| registry.npmjs.org | 200 |
| ollama.com | 200 |
| huggingface.co | 200 |

### Local AI runtime — was ABSENT, now installed

- Before reconnaissance: `ollama` **not found**; no `~/.ollama`; no `llama-server`; no `mlx_lm.server`.
- Port scan: only `:5000` was listening, and it is **macOS ControlCenter (AirPlay Receiver)**, not a model server.
- Action taken: `brew install ollama` → succeeded (exit 0). Server started, open-weight models pulled.

### Hosted model gateway (already running, no credentials needed)

`http://127.0.0.1:8787/v1` is an OpenAI-compatible gateway. `GET /v1/models` returned:

| Model id | Weight openness |
|---|---|
| **`gpt-oss-120b-medium`** | **open-weight (OpenAI gpt-oss)** |
| `gemini-3.7-flash*`, `gemini-pro-agent`, `gemini-3.1-pro-low` | closed |
| `claude-sonnet-4-6`, `claude-opus-4-6-thinking` | closed |

Quota was ~100% remaining at reconnaissance time.

**Why this matters:** the architecture can be honestly hybrid — local open-weight as the default
path, a *hosted open-weight* model as the escalation path, and closed models strictly optional and
never load-bearing. That is a defensible "open innovation matters" story, not decoration.

### Credentials

No sponsor or cloud credentials are present in the environment (`env` contains no API-key variables).
Nothing was printed or exfiltrated. Every sponsor integration must therefore work on a **free tier or
local dev server**, or be dropped.

---

## 3. Existing assets

The working directory was **empty** and **not a git repository**. No prior work to preserve, and
therefore no risk of submitting a recycled project — which the rules require to be new.

---

## 4. Constraints that shape the plan

1. **~13.5 hours wall clock.** Nothing may be built that cannot be demoed.
2. **16 GB RAM.** Local models must be ≤ ~8 GB at Q4. 7B-class is the practical ceiling for
   comfortable concurrent headroom; larger models must be served, not loaded.
3. **No credentials.** Rejects any sponsor requiring a paid tier or card.
4. **Write-up is the heaviest-weighted artifact.** Engineering must produce *evidence a reader can
   see*, not just a passing test suite.
5. **Theme compliance.** The project needs exactly one named human beneficiary with a real problem.

---

## 5. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Ship a technically strong project that ignores the theme → judged poorly | **Critical** | Re-anchor to one named developer; open the write-up with their words, not the architecture |
| R2 | Non-deterministic model output makes the "detect → rollback → repair" demo flaky | **Critical** | Record a real regression trace once, then replay it deterministically; live path still runs end-to-end |
| R3 | Time lost to a monorepo build graph | High | Single TypeScript project with path aliases; no per-package build steps |
| R4 | Local model too slow/tool-calling unreliable on 16 GB | High | ModelRouter with capability probing + automatic fallback to hosted open-weight |
| R5 | Scope creep into MCP / Temporal / desktop | High | P0/P1/P2 discipline; P2 cut first, without negotiation |
| R6 | Sponsor integrations that are cosmetic | Medium | Every integration must have an acceptance test proving it does real work, or it is dropped |

---

## 6. What reconnaissance changed

- Rejected: "generic autonomous agent platform" positioning — fails the theme.
- Rejected: any sponsor requiring paid infra or a card — no credentials exist.
- Rejected: multi-database architecture — one embedded store is sufficient and faster to prove.
- Adopted: local open-weight first (Gemma/Qwen via Ollama), hosted open-weight as escalation.
- Adopted: the write-up and its embedded evidence are **first-class deliverables**, scheduled
  alongside code rather than after it.

Detail and rationale for each choice: `DECISION.md`.
