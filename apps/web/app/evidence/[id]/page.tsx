import Link from "next/link";
import { notFound } from "next/navigation";
import { loadWorld, evidenceFor, VERDICT_GLYPH, VERDICT_TOKEN } from "@/lib/world";

export const dynamic = "force-dynamic";

function Diff({ text }: { text: string }) {
  const lines = text.split("\n").slice(0, 400);
  return (
    <pre className="mono text-xs leading-5 overflow-x-auto bg-[--color-ink-850] rounded border border-[--color-ink-800] p-3">
      {lines.map((l, i) => (
        <div
          key={i}
          className={l.startsWith("+") && !l.startsWith("+++") ? "diff-add" : l.startsWith("-") && !l.startsWith("---") ? "diff-del" : ""}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4 px-5 py-3 border-b border-[--color-ink-850] last:border-0">
      <div className="text-xs uppercase tracking-wide text-[--color-ink-400] pt-0.5">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = await loadWorld();
  const record = evidenceFor(snap.world, id);
  if (!record) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-sm">
        <Link href="/" className="text-[--color-ink-400] hover:text-[--color-ink-100]">
          ← dashboard
        </Link>
        <span className="mono text-[--color-ink-400]">{record.id}</span>
      </div>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 flex flex-wrap items-center gap-3 border-b border-[--color-ink-800]">
          <span className={`mono text-xl ${VERDICT_TOKEN[record.verdict] ?? ""}`}>
            {VERDICT_GLYPH[record.verdict] ?? "?"} {record.verdict}
          </span>
          <span className="text-xs text-[--color-ink-400] mono">
            digest {record.digest.slice(0, 20)}…
          </span>
          <span className="ml-auto text-xs text-[--color-ink-400]">{record.generatedAt}</span>
        </div>
        <Row label="asked for">
          <p>{record.originalIntent}</p>
        </Row>
        <Row label="understood as">
          <p className="text-[--color-ink-300]">{record.interpretation}</p>
          <p className="text-xs text-[--color-ink-400] mt-1">
            source: {record.interpretationProvenance.source}, confidence{" "}
            {record.interpretationProvenance.confidence}
            {record.interpretationProvenance.modelId ? `, model ${record.interpretationProvenance.modelId}` : ""} —
            an interpretation, not a fact
          </p>
        </Row>
        <Row label="plan">
          <ol className="space-y-1">
            {record.planSummary.map((s, i) => (
              <li key={i} className="mono text-xs text-[--color-ink-300]">
                {s}
              </li>
            ))}
          </ol>
        </Row>
        <Row label="why this verdict">
          <ul className="space-y-1">
            {record.verdictReasons.map((r, i) => (
              <li key={i} className="mono text-xs text-[--color-ink-300]">
                {r}
              </li>
            ))}
          </ul>
        </Row>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card">
          <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">Files changed</div>
          <ul className="divide-y divide-[--color-ink-850]">
            {record.changes.length === 0 && (
              <li className="px-5 py-4 text-sm text-[--color-ink-400]">No files were modified.</li>
            )}
            {record.changes.map((c) => (
              <li key={c.path} className="px-5 py-3 text-sm flex items-center gap-3">
                <span className="mono text-xs text-[--color-ink-400]">{c.change}</span>
                <span className="mono text-xs truncate">{c.path}</span>
                <span className="ml-auto mono text-xs text-[--color-ink-400]">
                  +{c.added ?? "?"} −{c.removed ?? "?"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">Commands executed</div>
          <ul className="divide-y divide-[--color-ink-850]">
            {record.commands.map((c, i) => (
              <li key={i} className="px-5 py-3 flex items-center gap-3 text-sm">
                <span className={`mono text-xs ${c.exitCode === 0 ? "text-[--color-verify]" : "text-[--color-danger]"}`}>
                  [{c.exitCode === 0 ? "ok" : "fail"}]
                </span>
                <span className="mono text-xs text-[--color-ink-400]">{c.layer}</span>
                <span className="mono text-xs truncate">{c.command}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {record.failures.length > 0 && (
        <section className="card">
          <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium text-[--color-danger]">
            Failures detected
          </div>
          {record.failures.map((f, i) => (
            <div key={i} className="px-5 py-4 border-b border-[--color-ink-850] last:border-0 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="mono text-[--color-danger]">{f.classification}</span>
                <span className="text-[--color-ink-400] text-xs">in {f.layer}</span>
              </div>
              <pre className="mono text-xs bg-[--color-ink-850] rounded border border-[--color-ink-800] p-3 overflow-x-auto whitespace-pre-wrap">
                {f.signal.slice(0, 2500)}
              </pre>
              {f.rootCause && (
                <p className="text-sm text-[--color-ink-300]">
                  <span className="text-[--color-ink-400] text-xs uppercase tracking-wide mr-2">
                    diagnosis (model hypothesis)
                  </span>
                  {f.rootCause}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {(record.rollbacks.length > 0 || record.repairs.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-6">
          {record.rollbacks.length > 0 && (
            <section className="card">
              <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium text-[--color-rollback]">
                Rollbacks
              </div>
              <ul className="divide-y divide-[--color-ink-850]">
                {record.rollbacks.map((r, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <div className="mono text-xs">{r.checkpointRef}</div>
                    <div className="text-xs text-[--color-ink-400] mt-1">
                      restored at {r.at} — {r.ok ? "verified against the checkpoint tree hash" : "FAILED"}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {record.repairs.length > 0 && (
            <section className="card">
              <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium text-[--color-verify]">
                Repairs attempted
              </div>
              <ul className="divide-y divide-[--color-ink-850]">
                {record.repairs.map((r, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <div className="text-xs text-[--color-ink-400]">
                      attempt {r.attempt} → <span className="mono">{r.outcome}</span>
                    </div>
                    <p className="mt-1 text-[--color-ink-300]">{r.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <section className="card">
        <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">Verification layers</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-[--color-ink-850]">
              {record.verification.layers.map((l) => (
                <tr key={l.layer}>
                  <td className="px-5 py-2 mono text-xs w-28">{l.layer}</td>
                  <td
                    className={`px-2 py-2 mono text-xs w-24 ${
                      !l.ran ? "text-[--color-ink-400]" : l.ok ? "text-[--color-verify]" : "text-[--color-danger]"
                    }`}
                  >
                    {!l.ran ? "not run" : l.ok ? "pass" : "FAIL"}
                  </td>
                  <td className="px-2 py-2 text-xs text-[--color-ink-400]">{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">
          Tools used &amp; models used
        </div>
        <Row label="tools">
          <div className="flex flex-wrap gap-2">
            {record.toolsUsed.map((t) => (
              <span key={t.tool} className="mono text-xs px-2 py-0.5 rounded border border-[--color-ink-700]">
                {t.tool} ×{t.count}{" "}
                <span className="text-[--color-ink-400]">[{t.highestPermission}]</span>
              </span>
            ))}
          </div>
        </Row>
        <Row label="models">
          <div className="flex flex-wrap gap-2">
            {record.modelsUsed.map((m) => (
              <span
                key={`${m.provider}:${m.modelId}`}
                className={`mono text-xs px-2 py-0.5 rounded border ${
                  m.weightClass === "open-weight"
                    ? "border-[--color-verify] text-[--color-verify]"
                    : "border-[--color-caution] text-[--color-caution]"
                }`}
              >
                {m.provider}:{m.modelId} · {m.weightClass}
              </span>
            ))}
          </div>
        </Row>
        {record.residualRisk.length > 0 && (
          <Row label="still check">
            <ul className="space-y-1 text-[--color-ink-300]">
              {record.residualRisk.map((r, i) => (
                <li key={i}>⚠ {r}</li>
              ))}
            </ul>
          </Row>
        )}
      </section>

      {record.finalDiff && (
        <section className="card">
          <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">Final diff</div>
          <div className="p-5">
            <Diff text={record.finalDiff} />
          </div>
        </section>
      )}
    </div>
  );
}
