/**
 * The tool surface, rendered from the runtime itself rather than from a hand-maintained list.
 *
 * If this page and the runtime ever disagree, the runtime is right — which is why this page
 * imports the real tool registry instead of describing it.
 */
import { ToolRuntime } from "@attest/tool-runtime";
import { PROJECT_DIR } from "@/lib/world";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const tools = ToolRuntime.withDefaults(PROJECT_DIR).list();
  const digest = ToolRuntime.withDefaults(PROJECT_DIR).surfaceDigest();

  const tone: Record<string, string> = {
    read: "text-[--color-ink-300] border-[--color-ink-700]",
    execute: "text-[--color-rollback] border-[--color-rollback]",
    write: "text-[--color-caution] border-[--color-caution]",
    dangerous: "text-[--color-danger] border-[--color-danger]",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tool surface</h1>
        <p className="text-sm text-[--color-ink-400] mt-1">
          Every action an autonomous run can take. There is no other path: a tool that is not registered cannot be
          invoked, and a mutation that escapes the project root is refused before any I/O happens.
        </p>
        <p className="mono text-xs text-[--color-ink-400] mt-2">surface digest {digest}</p>
      </div>

      <section className="card divide-y divide-[--color-ink-850]">
        {tools.map((t) => (
          <div key={t.name} className="px-5 py-4 flex flex-wrap items-start gap-4">
            <span className="mono text-sm w-32">{t.name}</span>
            <span className={`mono text-xs px-2 py-0.5 rounded border ${tone[t.permission] ?? ""}`}>
              {t.permission}
            </span>
            <span className="text-sm text-[--color-ink-400] flex-1 min-w-[16rem]">{t.description}</span>
            {t.mutating && (
              <span className="text-xs text-[--color-caution]">mutating</span>
            )}
          </div>
        ))}
      </section>

      <section className="card p-5 text-sm text-[--color-ink-300] space-y-2">
        <div className="text-xs uppercase tracking-wide text-[--color-ink-400]">Enforcement</div>
        <p>
          <span className="mono text-[--color-danger]">dangerous</span> tools are refused unless a run is started
          with explicit human approval. That is why an autonomous run cannot delete files by default, even though
          the capability exists.
        </p>
        <p>
          Commands matching a deny list — recursive deletes of home or root, piping a remote script into a shell,
          privilege escalation, <span className="mono">git push</span>, publishing packages, raw device writes —
          are refused before a process is spawned.
        </p>
      </section>
    </div>
  );
}
