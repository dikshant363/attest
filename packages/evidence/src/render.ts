import type { EvidenceRecord, Verdict } from "@attest/shared";

const VERDICT_LABEL: Record<Verdict, string> = {
  VERIFIED: "✅ VERIFIED",
  PARTIALLY_VERIFIED: "🟡 PARTIALLY VERIFIED",
  UNVERIFIED: "❌ UNVERIFIED",
  ROLLED_BACK: "↩️  ROLLED BACK",
  BLOCKED: "⛔ BLOCKED",
};

export interface RenderOptions {
  /** Include the full final diff. Off by default for terminal output. */
  includeDiff?: boolean;
  /** ANSI colours are stripped when false. */
  color?: boolean;
}

/**
 * Render an evidence record for a human.
 *
 * Ordering is deliberate: the question a developer asks first is "what did you do and
 * can I trust it", so verdict, intent and residual risk come before architecture detail.
 * The model's interpretation is always visibly separated from executed fact.
 */
export function renderEvidenceMarkdown(record: EvidenceRecord, opts: RenderOptions = {}): string {
  const L: string[] = [];
  const push = (s = "") => L.push(s);

  push(`# Evidence — ${record.id}`);
  push();
  push(`**Verdict: ${VERDICT_LABEL[record.verdict]}**`);
  push();
  push(`| | |`);
  push(`|---|---|`);
  push(`| Task | \`${record.taskId}\` |`);
  push(`| Execution | \`${record.executionId}\` |`);
  push(`| Generated | ${record.generatedAt} |`);
  push(`| Digest | \`${record.digest.slice(0, 32)}…\` |`);
  push(`| Models used | ${record.modelsUsed.map((m) => `\`${m.modelId}\` (${m.weightClass})`).join(", ") || "—"} |`);
  push();

  push(`## 1. What you asked for`);
  push();
  push(`> ${record.originalIntent.replace(/\n/g, "\n> ")}`);
  push();

  push(`## 2. What the system understood`);
  push();
  push(record.interpretation);
  push();
  push(
    `_Source: ${record.interpretationProvenance.source}, confidence ${record.interpretationProvenance.confidence}_` +
      (record.interpretationProvenance.modelId ? `, model \`${record.interpretationProvenance.modelId}\`` : ""),
  );
  push();
  push(
    `> Anything in this section is an interpretation, not a fact. Executed results appear below.`,
  );
  push();

  push(`## 3. The plan that was followed`);
  push();
  for (const s of record.planSummary) push(`- ${s}`);
  push();

  push(`## 4. What actually changed`);
  push();
  if (record.changes.length === 0) {
    push("_No files were modified._");
  } else {
    push(`| File | Change | + | − |`);
    push(`|---|---|---|---|`);
    for (const c of record.changes) {
      push(`| \`${c.path}\` | ${c.change} | ${c.added ?? "?"} | ${c.removed ?? "?"} |`);
    }
  }
  push();

  push(`## 5. Commands that were executed`);
  push();
  if (record.commands.length === 0) push("_No commands were executed._");
  else {
    push("```");
    for (const c of record.commands) {
      push(`[${c.exitCode === 0 ? "ok" : "fail"}] (${c.layer}) ${c.command}`);
    }
    push("```");
  }
  push();

  push(`## 6. Tools used`);
  push();
  if (record.toolsUsed.length === 0) push("_None._");
  else {
    push(`| Tool | Calls | Highest permission |`);
    push(`|---|---|---|`);
    for (const t of record.toolsUsed) push(`| \`${t.tool}\` | ${t.count} | ${t.highestPermission} |`);
  }
  push();

  push(`## 7. Verification results`);
  push();
  push(`| Layer | Result | Detail |`);
  push(`|---|---|---|`);
  for (const l of record.verification.layers) {
    const status = !l.ran ? "— not run" : l.ok ? "pass" : "**fail**";
    push(`| ${l.layer} | ${status} | ${l.summary} |`);
  }
  push();
  if (record.verification.skipped.length) {
    push(`Layers that did **not** run:`);
    for (const s of record.verification.skipped) push(`- ${s}`);
    push();
  }

  if (record.failures.length > 0) {
    push(`## 8. What went wrong`);
    push();
    for (const f of record.failures) {
      push(`### \`${f.classification}\` in ${f.layer}`);
      push();
      push("```");
      push(f.signal.slice(0, 1500));
      push("```");
      if (f.rootCause) {
        push(`Diagnosis (model-authored hypothesis): ${f.rootCause}`);
        push();
      }
    }
  }

  if (record.repairs.length > 0) {
    push(`## 9. Repairs attempted`);
    push();
    for (const r of record.repairs) {
      push(`- Attempt ${r.attempt}: ${r.description} → **${r.outcome}**`);
    }
    push();
  }

  if (record.rollbacks.length > 0) {
    push(`## 10. Rollbacks`);
    push();
    for (const r of record.rollbacks) {
      push(`- \`${r.checkpointRef}\` restored at ${r.at} — ${r.ok ? "verified" : "**FAILED**"}`);
    }
    push();
  }

  push(`## 11. Why this verdict`);
  push();
  for (const r of record.verdictReasons) push(`- ${r}`);
  push();

  push(`## 12. Acceptance criteria coverage`);
  push();
  if (record.acceptanceCoverage.length === 0) {
    push("_No acceptance criteria were recorded for this task._");
  } else {
    push(`| Criterion | Exercised by a test? |`);
    push(`|---|---|`);
    for (const c of record.acceptanceCoverage) {
      // "not assessable" must win over "yes": a criterion we could not parse into a signal
      // is treated as covered so we never accuse a change of missing something we failed to
      // understand — but reporting that as "yes" would overstate what was checked.
      const label =
        c.signals.length === 0
          ? "not assessable"
          : c.covered
            ? `yes — ${c.matchedSignals.slice(0, 3).map((m) => `\`${m}\``).join(", ")}`
            : c.concrete
              ? "**no**"
              : "not assessable";
      push(`| ${c.criterion.slice(0, 120)} | ${label} |`);
    }
    push();
    push(
      `This is a smoke alarm, not proof: it checks whether a test *references* the surface ` +
        `named by the criterion, not whether the test asserts anything useful.`,
    );
  }
  push();

  push(`## 13. What you should still check yourself`);
  push();
  if (record.residualRisk.length === 0) {
    push("_Nothing outstanding that the runtime could identify._");
  } else {
    for (const r of record.residualRisk) push(`- ⚠️ ${r}`);
  }
  push();

  if (opts.includeDiff && record.finalDiff) {
    push(`## 14. Final diff`);
    push();
    push("```diff");
    push(record.finalDiff.slice(0, 20_000));
    push("```");
    push();
  }

  push(`---`);
  push();
  push(
    `_This record is sealed. Its digest covers the intent, interpretation, changes, commands, ` +
      `tools, models, test results, failures, repairs, rollbacks and verdict. Re-run ` +
      `\`attest verify --evidence ${record.id}\` to detect edits._`,
  );
  push();

  return L.join("\n");
}

/** Compact one-screen summary for `attest status`. */
export function renderEvidenceSummary(record: EvidenceRecord): string {
  const lines: string[] = [];
  lines.push(`${VERDICT_LABEL[record.verdict]}  ${record.id}  task=${record.taskId}`);
  lines.push(`  intent     : ${record.originalIntent.slice(0, 100)}`);
  lines.push(`  files      : ${record.changes.length} changed`);
  lines.push(`  models     : ${record.modelsUsed.map((m) => `${m.modelId}(${m.weightClass})`).join(", ")}`);
  lines.push(
    `  layers     : ${record.verification.layers.map((l) => `${l.layer}=${!l.ran ? "skipped" : l.ok ? "pass" : "FAIL"}`).join(" ")}`,
  );
  if (record.failures.length) lines.push(`  failures   : ${record.failures.length}`);
  if (record.rollbacks.length) lines.push(`  rollbacks  : ${record.rollbacks.length}`);
  if (record.uncoveredCriteria.length) lines.push(`  untested   : ${record.uncoveredCriteria.length} acceptance criterion(ia)`);
  if (record.residualRisk.length) lines.push(`  residual   : ${record.residualRisk.length} item(s)`);
  return lines.join("\n");
}
