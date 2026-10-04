import Link from "next/link";
import {
  loadWorld,
  latestEvidence,
  VERDICT_GLYPH,
  VERDICT_TOKEN,
} from "@/lib/world";
import { Statement } from "@/components/statement";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const snap = await loadWorld();

  if (!snap.ok || !snap.world) {
    return (
      <div className="card p-8">
        <h1 className="text-xl font-semibold mb-2">No Project World found</h1>
        <p className="text-[--color-ink-300] text-sm mb-4">
          The control centre reads <span className="mono">.attest/world.json</span> directly. Nothing has been
          analysed at:
        </p>
        <pre className="mono text-xs bg-[--color-ink-850] p-3 rounded border border-[--color-ink-800] overflow-x-auto">
          {snap.worldFile}
        </pre>
        <p className="text-[--color-ink-300] text-sm mt-4">
          Run <span className="mono text-[--color-accent]">attest init --dir &lt;repo&gt;</span> first, or start this
          app with <span className="mono">ATTEST_PROJECT_DIR</span> pointing at an analysed repository.
        </p>
      </div>
    );
  }

  const { world, audit } = snap;
  const project = world.project;
  const latest = latestEvidence(world);
  const tasks = [...world.tasks].reverse();

  const stats = [
    { label: "tasks", value: world.tasks.length },
    { label: "verified", value: world.tasks.filter((t) => t.verdict === "VERIFIED").length, tone: "verify" },
    { label: "rolled back", value: world.tasks.filter((t) => t.verdict === "ROLLED_BACK").length, tone: "rollback" },
    { label: "failures seen", value: world.failures.length, tone: "danger" },
    { label: "evidence sealed", value: world.evidence.length },
    { label: "checkpoints", value: world.checkpoints.length },
  ];

  const models = new Map<string, { runs: number; weightClass: string; role: string }>();
  for (const run of world.modelRuns) {
    const key = `${run.model.provider}:${run.model.modelId}`;
    const cur = models.get(key);
    if (cur) cur.runs++;
    else models.set(key, { runs: 1, weightClass: run.model.weightClass, role: run.role });
  }

  return (
    <div className="space-y-8">
      {/* ---- project header ------------------------------------------------- */}
      <section>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <span className="text-sm text-[--color-ink-400] mono">world rev {project.worldRevision}</span>
          {project.repository.branch && (
            <span className="text-sm text-[--color-ink-400] mono">
              {project.repository.branch} @ {project.repository.headSha}
            </span>
          )}
        </div>
        <p className="text-sm text-[--color-ink-400] mono mt-1 break-all">{project.root}</p>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {project.stack.languages.map((l) => (
            <span key={l} className="mono px-2 py-0.5 rounded border border-[--color-ink-700] text-[--color-ink-300]">
              {l}
            </span>
          ))}
          {project.stack.frameworks.map((f) => (
            <span key={f} className="mono px-2 py-0.5 rounded border border-[--color-ink-700] text-[--color-ink-300]">
              {f}
            </span>
          ))}
          {project.commands.map((c) => (
            <span key={c.command} className="mono px-2 py-0.5 rounded border border-[--color-ink-700] text-[--color-ink-300]">
              {c.kind}: {c.command}
            </span>
          ))}
        </div>
      </section>

      {/* ---- stats ---------------------------------------------------------- */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[--color-ink-400]">{s.label}</div>
            <div
              className={`mono text-2xl mt-1 ${
                s.tone === "verify"
                  ? "text-[--color-verify]"
                  : s.tone === "danger"
                    ? "text-[--color-danger]"
                    : s.tone === "rollback"
                      ? "text-[--color-rollback]"
                      : ""
              }`}
            >
              {s.value}
            </div>
          </div>
        ))}
      </section>

      {/* ---- latest verdict -------------------------------------------------- */}
      {latest && (
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[--color-ink-800] flex flex-wrap items-center gap-3">
            <span className={`mono text-xl ${VERDICT_TOKEN[latest.verdict] ?? ""}`}>
              {VERDICT_GLYPH[latest.verdict] ?? "?"} {latest.verdict}
            </span>
            <span className="text-sm text-[--color-ink-400]">
              the most recent task, and why its result is trusted
            </span>
            <Link
              href={`/evidence/${latest.id}`}
              className="ml-auto text-sm text-[--color-accent] hover:underline"
            >
              full evidence →
            </Link>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-[--color-ink-400] mb-1">asked for</div>
              <p className="text-[15px]">{latest.originalIntent}</p>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-[--color-ink-400] mb-1">
                understood as <span className="normal-case tracking-normal">(model interpretation)</span>
              </div>
              <p className="text-sm text-[--color-ink-300]">{latest.interpretation}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-[--color-ink-400] mb-2">verification</div>
                <ul className="space-y-1">
                  {latest.verification.layers.map((l) => (
                    <li key={l.layer} className="flex items-center gap-2 text-sm">
                      <span
                        className={`mono w-4 ${
                          !l.ran
                            ? "text-[--color-ink-400]"
                            : l.ok
                              ? "text-[--color-verify]"
                              : "text-[--color-danger]"
                        }`}
                      >
                        {!l.ran ? "–" : l.ok ? "✓" : "✗"}
                      </span>
                      <span className="mono w-24 text-[--color-ink-300]">{l.layer}</span>
                      <span className="text-[--color-ink-400] text-xs">{l.summary}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-[--color-ink-400] mb-2">
                  what actually happened
                </div>
                <ul className="space-y-1 text-sm text-[--color-ink-300]">
                  <li>
                    <span className="mono text-[--color-ink-400]">{latest.changes.length}</span> file(s) changed
                  </li>
                  <li>
                    <span className="mono text-[--color-ink-400]">{latest.commands.length}</span> command(s) executed
                  </li>
                  <li>
                    <span className="mono text-[--color-danger]">{latest.failures.length}</span> failure(s) detected
                  </li>
                  <li>
                    <span className="mono text-[--color-rollback]">{latest.rollbacks.length}</span> rollback(s) performed
                  </li>
                  <li>
                    <span className="mono text-[--color-verify]">{latest.repairs.length}</span> repair attempt(s)
                  </li>
                </ul>
              </div>
            </div>

            {latest.residualRisk.length > 0 && (
              <div className="border-t border-[--color-ink-800] pt-3">
                <div className="text-xs uppercase tracking-wide text-[--color-caution] mb-1">
                  still worth your attention
                </div>
                <ul className="space-y-1 text-sm text-[--color-ink-300]">
                  {latest.residualRisk.map((r, i) => (
                    <li key={i}>⚠ {r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ---- tasks ---------------------------------------------------------- */}
        <section className="card">
          <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">Tasks</div>
          <ul className="divide-y divide-[--color-ink-800]">
            {tasks.length === 0 && <li className="px-5 py-4 text-sm text-[--color-ink-400]">No tasks yet.</li>}
            {tasks.slice(0, 8).map((t) => (
              <li key={t.id} className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className={`mono text-sm ${VERDICT_TOKEN[t.verdict ?? ""] ?? "text-[--color-ink-400]"}`}>
                    {VERDICT_GLYPH[t.verdict ?? ""] ?? "·"} {t.verdict ?? t.status}
                  </span>
                  <span className="text-xs text-[--color-ink-400] mono ml-auto">
                    attempt {t.attempt}/{t.maxAttempts}
                  </span>
                </div>
                <p className="text-sm mt-1 text-[--color-ink-300]">{t.intent.text}</p>
                {t.evidenceId && (
                  <Link href={`/evidence/${t.evidenceId}`} className="text-xs text-[--color-accent] hover:underline">
                    evidence {t.evidenceId}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-6">
          {/* ---- models ------------------------------------------------------- */}
          <section className="card">
            <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">
              Models used <span className="text-[--color-ink-400] font-normal">— the open-source core</span>
            </div>
            <ul className="divide-y divide-[--color-ink-800]">
              {models.size === 0 && (
                <li className="px-5 py-4 text-sm text-[--color-ink-400]">No model runs recorded.</li>
              )}
              {[...models.entries()].map(([key, info]) => (
                <li key={key} className="px-5 py-3 flex items-center gap-3 text-sm">
                  <span className="mono">{key}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${
                      info.weightClass === "open-weight"
                        ? "border-[--color-verify] text-[--color-verify]"
                        : "border-[--color-caution] text-[--color-caution]"
                    }`}
                  >
                    {info.weightClass}
                  </span>
                  <span className="ml-auto text-xs text-[--color-ink-400] mono">{info.runs} run(s)</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ---- constraints -------------------------------------------------- */}
          <section className="card">
            <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">
              Constraints the agent must not break
            </div>
            <ul className="divide-y divide-[--color-ink-800]">
              {project.constraints.map((c) => (
                <li key={c.id} className="px-5 py-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span
                      className={`mono text-xs mt-0.5 ${
                        c.origin === "human" ? "text-[--color-accent]" : "text-[--color-ink-400]"
                      }`}
                    >
                      {c.origin === "human" ? "declared" : "derived"}
                    </span>
                    <span className="text-[--color-ink-300]">{c.statement}</span>
                  </div>
                  {c.enforcedBy && (
                    <div className="mono text-xs text-[--color-ink-400] mt-1 ml-14">{c.enforcedBy}</div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* ---- unknowns ----------------------------------------------------- */}
          {project.unknowns.length > 0 && (
            <section className="card">
              <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium">
                What Attest does not know
              </div>
              <ul className="px-5 py-3 space-y-1 text-sm text-[--color-ink-400]">
                {project.unknowns.map((u, i) => (
                  <li key={i}>— {u}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* ---- audit tail ------------------------------------------------------- */}
      <section className="card">
        <div className="px-5 py-3 border-b border-[--color-ink-800] text-sm font-medium flex items-center">
          Append-only audit log
          <Link href="/audit" className="ml-auto text-xs text-[--color-accent] hover:underline">
            all entries →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs mono">
            <tbody className="divide-y divide-[--color-ink-850]">
              {audit.slice(0, 10).map((a) => (
                <tr key={a.seq} className="hover:bg-[--color-ink-850]">
                  <td className="px-5 py-2 text-[--color-ink-400]">{a.seq}</td>
                  <td className="px-2 py-2 text-[--color-ink-400]">{a.actor}</td>
                  <td className="px-2 py-2 text-[--color-ink-300]">{a.action}</td>
                  <td className="px-2 py-2 text-[--color-ink-400]">{a.permission}</td>
                  <td className="px-2 py-2 text-[--color-ink-400] truncate max-w-md">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Statement />
    </div>
  );
}
