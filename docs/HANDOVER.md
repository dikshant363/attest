# HANDOVER.md

> Everything that is done, and the short list of things only you can do.

---

## Status: the build is complete

**Repository:** https://github.com/dikshant363/attest (public, Apache-2.0)
**Verification:** `node scripts/verify-all.mjs` → typecheck · lint · 83 tests · web build · CLI smoke test — all passing
**Submission draft:** [`docs/ARTICLE.md`](ARTICLE.md) — ready to paste into DEV

Fully working: Project World, checkpointed execution, 7-layer verification, the
acceptance-criteria coverage gate, enforced rollback, sealed evidence, CLI, web control centre,
local open-weight inference (Gemma 4, verified on this machine), and Sentry instrumentation that is
proven to emit spans.

---

## The four things only you can do

### 1. Publish the DEV post (required — the deadline is Oct 5, 06:59 UTC)

1. Open https://dev.to/new
2. Copy the whole of [`docs/ARTICLE.md`](ARTICLE.md) and paste it in.
3. Set the tags: `devchallenge`, `weekendchallenge`, `hf26challenge`, `hacktoberfest`, `opensource`, `ai`
4. Cover image: use `docs/images/control-centre-dashboard.png` (upload it, or let DEV fetch it).
5. DEV will re-host the two GitHub image URLs automatically when you preview.
6. **Publish before 06:59 UTC.**

The title is already written: *I built my friend Aarav an agent that refuses to say "done"*.

### 2. Sentry — 5 minutes, if you want the category

1. https://sentry.io → sign up free → create a project → choose **Node.js**
2. Settings → **Client Keys (DSN)** → copy the DSN
3. Tell me the DSN, or run it yourself:

```bash
cd attest
export SENTRY_DSN='https://<your-dsn>'
node bin/attest.mjs trace --test        # sends a probe span
node bin/attest.mjs demo --dir examples/auth-fixture --offline
```

4. Open **Traces** in Sentry, screenshot the trace, and paste it into the *Best Use of Sentry Agent
   Tracing* section of the post (there is a marked `<!-- PENDING -->` comment).

**If you do not do this, delete that section from the post.** An unclaimed category is better than a
claimed one, and the write-up already describes the instrumentation accurately either way.

### 3. Render — 5 minutes, if you want the category

1. https://dashboard.render.com → **New** → **Blueprint**
2. Pick the `dikshant363/attest` repository. `render.yaml` is already committed, so it needs no
   configuration.
3. Wait for the deploy, then send me the URL (or paste it into the *Best Use of Render* section).
4. **Warm it before you record anything** — the free tier sleeps after 15 idle minutes and takes
   about a minute to wake, which is a great way to make a live demo look broken.

**If you do not do this, delete that section too.**

### 4. Hand it to Aarav (this is the bonus point)

The rules say: *"Bonus points if you actually hand it over and tell us what they said."*

```bash
# on Aarav's machine, or yours with his repo
git clone https://github.com/dikshant363/attest && cd attest
npm install
ollama pull gemma4:e2b
node bin/attest.mjs init --dir /path/to/his/project
node bin/attest.mjs task "something he actually wants done" --dir /path/to/his/project
```

Then add two or three sentences to the end of the post about what he said. Even "he tried it and it
rolled back a bad change" makes the post measurably stronger, because the theme is literally *build
for a friend*.

---

## Optional: DevRelay agent session

DevRelay is an MCP server that installs a gateway on your machine and registers itself with your
coding agents. I did **not** run the installer, for two reasons: it pipes a remote script into a
shell (which this project's own command policy refuses), and it installs system-wide software and
requires interactive MLH sign-in. Those are your calls to make, not mine.

If you want it:

```bash
curl -fsSL https://devrelay.com/install.sh | sh    # then restart your agent, sign in with MLH
```

Then ask your agent to save the session and paste the link into the *My Agent Session* section of the
post. The section currently points at the two sealed evidence records from real runs instead, which
is accurate and arguably a better artifact — they are verifiable and include the parts a chat
transcript omits.

---

## What is deliberately not in the submission

These are **designed for but not shipped**, and the post says so rather than implying otherwise:

| | Why not |
|---|---|
| **MCP server** | The tool registry is already the right shape, but a half-wired MCP server is a *new path that bypasses the permission model*. Shipping it would have made the tool-safety story weaker, not stronger. |
| **Temporal durability** | The Workflow/Activity refactor is 4+ hours, and the checkpoint-and-rollback guarantee was worth more than durable execution at this scale. |
| **External agent delegation** | Needs a stable structured-result contract and per-agent sandboxing. |
| **Desktop / mobile** | Web + CLI already deliver the experience. |

## If someone challenges a claim

Every claim in the post is backed by something runnable:

| Claim | Where to check it |
|---|---|
| The recovery loop works | `npx vitest run tests/end-to-end.test.ts` |
| It fails safely when repair is impossible | Same file — the workspace is asserted byte-for-byte |
| A verdict is never written by a model | `grep -rn "verdict =" packages/` — one assignment site |
| Non-open-weight models are refused | `npx vitest run tests/router.test.ts` |
| The evidence seal detects edits | `attest verify`, edit `world.json`, `attest verify` |
| Spans really are emitted | `npx vitest run tests/observability.test.ts` |
| A local open-weight model really works | `attest demo` with `--offline` |
| The coverage gate is real | `npx vitest run -t "caps the verdict"` |

## Reset between demo runs

```bash
npm run fixture:reset      # npm test does this automatically
```
