import { loadWorld } from "@/lib/world";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const snap = await loadWorld();
  const audit = snap.audit;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-[--color-ink-400] mt-1">
          Append-only. Every tool call, checkpoint, rollback, verdict and human override is recorded with the
          permission level it required. Nothing in the runtime mutates state without passing through here.
        </p>
      </div>

      <section className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[--color-ink-400] border-b border-[--color-ink-800]">
              <th className="px-4 py-2 text-left font-medium w-14">seq</th>
              <th className="px-2 py-2 text-left font-medium w-20">actor</th>
              <th className="px-2 py-2 text-left font-medium w-24">permission</th>
              <th className="px-2 py-2 text-left font-medium w-52">action</th>
              <th className="px-2 py-2 text-left font-medium">detail</th>
              <th className="px-4 py-2 text-left font-medium w-52">at</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-ink-850] mono">
            {audit.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[--color-ink-400]">
                  No audit entries yet.
                </td>
              </tr>
            )}
            {audit.map((a) => (
              <tr key={a.seq} className="hover:bg-[--color-ink-850]">
                <td className="px-4 py-2 text-[--color-ink-400]">{a.seq}</td>
                <td
                  className={`px-2 py-2 ${
                    a.actor === "human" ? "text-[--color-accent]" : "text-[--color-ink-300]"
                  }`}
                >
                  {a.actor}
                </td>
                <td
                  className={`px-2 py-2 ${
                    a.permission === "dangerous"
                      ? "text-[--color-danger]"
                      : a.permission === "write"
                        ? "text-[--color-caution]"
                        : "text-[--color-ink-400]"
                  }`}
                >
                  {a.permission}
                </td>
                <td className="px-2 py-2">{a.action}</td>
                <td className="px-2 py-2 text-[--color-ink-400]">{a.detail}</td>
                <td className="px-4 py-2 text-[--color-ink-400]">{a.at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
