# ARCHITECTURE.md

> How Attest is put together, and — more usefully — why each part is the way it is.

---

## 1. The one-sentence design

**Attest treats an engineering task as a transaction: checkpoint, mutate, evaluate, commit or
revert, and leave a receipt.**

Everything below follows from that sentence. If a design decision does not serve reversibility,
verification, or explainability, it is not in the codebase.

## 2. Layering

```
                        ┌──────────────────────────────────────────┐
   CLI  ───────────────▶│                                          │
   (shipped)            │            CORE RUNTIME                  │
                        │                                          │
   Web control centre ─▶│  ProjectWorld   ModelRouter              │
   (read-only, shipped) │  ToolRuntime    VerificationEngine        │
                        │  Evidence       AgentLoop                 │
   API / MCP / desktop ─▶│                                          │
   (designed for,        └──────────────────────────────────────────┘
    not shipped)                          │
                        ┌─────────────────┼─────────────────┐
                        ▼                 ▼                 ▼
                 LocalProvider    HostedOpenProvider   CloudProvider
                 (ollama, open    (gpt-oss-120b,       (refused by
                  weights)         open weights)        default)
```

The runtime is the product. Every interface is an adapter over `AttestRuntime`. The web app does
not reimplement anything — it reads the Project World from disk. There is no second source of truth
to drift.

**Why one JSON document instead of Postgres.** For a single-developer local tool, a database adds a
connection to fail, a migration to run, and a daemon to start, in exchange for query capability this
workload does not use. The world is a bounded, human-inspectable document written atomically, and
the audit log is append-only. `WorldStore` is the seam: swapping in SQLite or Postgres means
changing one class, not the runtime. This is recorded as a decision in `DECISIONS.md`.

## 3. The Project World

The world is the answer to "why does this agent need me to explain the project again?"

```
Project
 ├── stack            languages, frameworks, package manager, dependencies
 ├── repository       branch, HEAD, dirtiness
 ├── commands         what verification is ALLOWED to execute
 ├── testFiles        discovered test surfaces
 ├── tree             bounded directory listing for context building
 ├── constraints      what a change must not break
 ├── decisions        architecture decisions, with reasons
 └── unknowns         what the analyser could not determine
```

Plus the working set: `tasks`, `plans`, `executions`, `checkpoints`, `failures`, `verifications`,
`evidence`, `memories`, `modelRuns`.

### Two rules that shape it

**Commands are discovered, never invented.** The analyser reads the project's own manifests. If a
repository declares no test command, Attest does not guess one — it records that in `unknowns`, and
the verification engine will refuse to claim `VERIFIED`. An agent that invents a test command is an
agent that can invent a passing test.

**Constraints carry provenance.** A constraint is either `discovered` (an artifact enforces it) or
`human` (declared in `attest.constraints.json`). The analyser will not synthesise a constraint it
cannot point at. Constraints are injected into the planner and implementer prompts — a 2B model will
not go looking for them, so they are put in front of it.

**Ignorance is a first-class field.** `unknowns` is rendered in the UI and fed to the model. An
agent that does not know it does not know something will confidently invent it.

## 4. Model routing: open-weight first, and enforced

```
ModelRouter
  ├── policy filter      proprietary weights refused unless ATTEST_ALLOW_PROPRIETARY=1
  │                      offline-only mode refuses anything that leaves the machine
  ├── capability filter  structured output required; code-strength gate per role
  ├── availability       is the provider actually up right now
  ├── fit score          privacy, capability, cost tier, measured latency
  └── fallback chain     every remaining candidate, best first; each attempt recorded
```

Three decisions worth defending:

**Refusing proprietary models by default is the strongest thing in this file.** It would be trivial
to write "open-source AI is central" in a README while quietly escalating every hard step to a
frontier model. Making the router refuse closed weights turns that claim into a property you can
test — and there is a test for it.

**Fallbacks are recorded, including the failures.** A silent fallback would make the evidence record
lie about which model produced a change. Every attempt emits a `ModelRun`, so "which model did this"
is always answerable.

**No hard capability gate on the repair role.** The obvious move is `repairer requires codeStrength
≥ 0.55`. That reads as rigour and is actually a bug: it silently excludes every small local model
from the repair step, so the runtime stops working offline exactly when the developer needs it most.
Repair therefore *prefers* stronger models through difficulty weighting while keeping weak ones
eligible. This was caught while writing the tests, and is why `minCodeStrength` is used sparingly.

**Capability priors are priors.** `attest models --probe` measures latency and JSON compliance on
this machine and replaces the static table. We do not claim a capability we have not observed.

## 5. The tool runtime: one gate, no escape hatch

```
invoke(name, input, ctx)
  1. resolve the tool            → unregistered tools cannot be called
  2. validate against its schema  → zod contract, errors are surfaced not swallowed
  3. enforce permission          → read · execute · write · dangerous
  4. enforce timeout
  5. execute
  6. normalise mutations         → FileChange records for the evidence trail
  7. emit an auditable ToolCall  → success or failure
```

| Tool | Permission | Mutating |
|---|---|---|
| `read_file`, `list_files`, `search`, `git_status`, `git_diff` | read | no |
| `run_command` | execute | no |
| `write_file`, `edit_file`, `apply_edits` | write | yes |
| `delete_file` | **dangerous** | yes |

**Path safety is a chokepoint, not a convention.** `resolveInsideRoot` is called by every
filesystem tool. Traversal, absolute paths outside the root, and NUL bytes are refused before any
I/O. `.git/` and `.attest/` are never writable.

**`delete_file` is `dangerous`, and `dangerous` is off by default.** So an autonomous run cannot
delete files unless a human passes `--yes-dangerous` for that run. The capability exists; the
authority does not, unless granted. A test asserts the refusal actually happens and the file
survives — refusing is not advisory.

**`apply_edits` is atomic.** Every edit in a batch is validated before any is written. A batch that
would half-apply is rejected whole.

**Exact-string replacement over diff parsing.** `edit_file` takes `search`/`replace` and *fails
loudly* if the search text is missing or matches more than once. Small open-weight models produce
reliable search/replace far more often than syntactically valid unified diffs, and ambiguity must be
an error rather than a silent guess.

**Command policy refuses before spawning.** Recursive deletes of home or root, piping a remote
script into a shell, `sudo`, `git push`, `git reset --hard`, package publishing, fork bombs, raw
device writes. Model output is never executed directly — commands come from the project's manifests
or from plan steps a human can inspect.

## 6. Checkpoints: why not `git stash`

The obvious implementation is `git stash` / `git reset --hard`. It is rejected deliberately: those
operate on the developer's **real** git state, and an autonomous `reset --hard` can destroy work
that was never committed. A runtime that can silently destroy the last known-good state has failed
at the only thing it promises.

Instead, a checkpoint is a private, self-contained snapshot of the project's text files under
`.attest/checkpoints/`, with a hash over the sorted `path:hash` list:

```
create()   scan project text files (bounded) → snapshot + treeHash, recorded with git HEAD
restore()  rewrite captured files → delete files created since → recompute treeHash
verify     ok = (errors.length === 0) && (treeHashAfter === checkpoint.treeHash)
```

The rollback's success is *proven*, not assumed. Ignored trees (`node_modules`, `dist`, …) are never
captured and never deleted, so a rollback cannot remove a build artifact or a dependency tree.

**Cost:** disk proportional to the project's source size. **Benefit:** rollback is a file operation
the runtime fully controls, works in a non-git directory, and never touches the developer's branch,
index, or stash.

## 7. Verification: executed, layered, and honest about gaps

```
security   in-process rule scan over the CHANGED files only     REQUIRED, always runs
unit       the project's own test command                       REQUIRED if declared
typecheck  the project's own typecheck command                  optional
lint       the project's own lint command                       optional
build      the project's own build command                      optional
e2e        the project's own e2e command                        optional
regression baseline test counts compared to the post-change run optional
```

**A pre-flight baseline runs before any mutation.** This is what lets Attest distinguish "I broke it"
from "it was already broken". If the repository is already red, the verdict says so and the residual
risk states that pass/fail is not conclusive.

**The verdict is a pure function.** `computeVerdict(layers)` maps layer results to a verdict with no
model, no clock, and no I/O in the path. Same inputs, same verdict, always.

```
any required layer failed                      → UNVERIFIED
a required layer could not run                 → UNVERIFIED   ← absence of evidence ≠ success
only optional layers failed                    → PARTIALLY_VERIFIED
all required layers pass                       → VERIFIED
skipped optional layers                        → reported, never counted as passing
```

**Skipped layers are named.** "Not checked: lint, build, e2e" appears in the record. A developer who
does not know what was skipped cannot calibrate their trust.

**Security scanning is scoped to the change.** Reporting pre-existing findings in untouched files
trains developers to ignore the layer. Test files and examples are exempt, because a hardcoded
credential in a fixture is the point of the fixture.

## 8. The agent loop

```
1  create task                    intent captured verbatim, with provenance
2  interpret                      model → testable acceptance criteria + stated ambiguities
3  plan                           model → ordered steps, named targets, risks
4  baseline                       run the project's own tests BEFORE touching anything
5  for attempt in 1..maxAttempts:
     a  checkpoint                (invariant: nothing mutates outside a checkpoint)
     b  execute                   investigate → read via the tool runtime → edit via apply_edits
     c  verify                    the layered engine, above
     d  if acceptable             independent review → evidence → done
     e  else  record failure      classified from the layer + the real signal
     f  if maxAttempts reached    rollback → evidence says ROLLED_BACK → stop
     g  else  rollback            restore, verified by tree hash
     h  diagnose + repair         model, prompted with the real failure and the rolled-back files
     i  loop                      the repair becomes the next attempt's change set
6  evidence                       assembled from observed artifacts; sealed with a digest
```

### Invariants

1. No mutation happens outside a checkpoint.
2. A verdict comes only from `computeVerdict()`. Never from a model.
3. A failed attempt is rolled back **before** it is repaired, so the repair is computed against a
   known-good workspace rather than on top of a broken one.
4. The loop stops after `maxAttempts` and reports, rather than thrashing.
5. An Evidence record is produced on **every** terminal path, including failure.

### Two design choices worth stating

**Repair happens after rollback, not on top of the failure.** Diagnosing a broken tree invites
compounding errors; a repair computed against known-good state is far more likely to be correct, and
the rollback itself becomes demonstrated rather than incidental.

**Investigation is deterministic where it can be.** Rather than hoping a small model issues the right
tool calls, the loop gathers context (bounded, read-only, audited) and then makes a single edit call.
The model still drives the edit; the plumbing is not left to chance. A fully model-driven tool loop
is a natural extension and is listed as such under limitations rather than half-built.

**The reviewer is routed away from the author.** A model reviewing its own output adds latency and
very little signal, so the reviewer selection excludes the author's provider and model.

## 9. Evidence

`buildEvidence()` assembles a record from *observed* artifacts: the tool runtime's `FileChange`
records, the verification engine's parsed test counts, the failure signals, the checkpoint restore
reports. Model-authored text appears exactly twice, and is labelled both times: the interpretation
(with `source: "model"` and a confidence) and root-cause hypotheses.

`digestEvidence()` hashes the record's substance; `verifyEvidenceDigest()` recomputes it. Editing a
sealed record breaks the seal — `attest verify` detects it. The digest is not the *only* control,
which is why the record also carries the raw layer results that produced the verdict: a digest
proves a record is unmodified, not that it is true.

## 10. Safety: defence in depth, not one gate

| Layer | Control |
|---|---|
| Source | Untrusted-content notice appended to **every** system prompt |
| Prompt | Repository content framed as data; constraints stated up front |
| Action | Tool schemas, permission levels, path chokepoint, parameterised commands |
| Process | Command deny list evaluated before spawn |
| Change | Checkpoint before mutation; atomic edit batches |
| Evaluation | Layered execution; pre-flight baseline; computed verdict |
| Recovery | Verified rollback on failure; stop after `maxAttempts` |
| Record | Append-only audit log; sealed evidence with a digest |
| Human | pause · resume · cancel · rollback · inspect · approve · reject |

No single layer is trusted. The prompt notice is a mitigation, not a guarantee — which is precisely
why enforcement lives in the tool runtime and the verdict is computed from executed checks.

## 11. What was deliberately not built

Desktop app, mobile, MCP server, external-agent delegation, vector memory, Temporal durability,
multi-agent choreography, fine-tuning, hosted deployment.

Each was considered and cut. The reasoning is in `DECISIONS.md`: an unfinished durable-workflow
integration is worth less than a completed checkpoint-and-rollback guarantee, and the theme of this
build is *provable* safety rather than surface area. The MCP server in particular is designed for —
the tool registry is already the right shape — but shipping a half-wired one would have made the
tool-safety story weaker, not stronger.

## 12. Reading order

1. `packages/shared/src/types.ts` — the domain vocabulary
2. `packages/project-world/src/analyzer.ts` — what is observed, and what is admitted as unknown
3. `packages/tool-runtime/src/registry.ts` — the single gate
4. `packages/tool-runtime/src/checkpoint.ts` — reversible by construction
5. `packages/verification/src/engine.ts` — `computeVerdict`, the anti-overclaiming rule
6. `packages/agent-runtime/src/loop.ts` — the loop and its five invariants
7. `packages/evidence/src/evidence.ts` — the receipt
8. `tests/end-to-end.test.ts` — the claims, executed
