export function Statement() {
  return (
    <section className="card p-5 text-sm text-[--color-ink-300] leading-relaxed">
      <div className="text-xs uppercase tracking-wide text-[--color-ink-400] mb-2">What you are looking at</div>
      <p>
        Every value on this page was observed, not asserted. The file changes came from the tool runtime&apos;s
        own records. The test counts were parsed out of the runner&apos;s output. The verdict was computed from
        the layer results by a pure function, and a model never gets to write it.
      </p>
      <p className="mt-3">
        Where a model&apos;s judgement does appear — the interpretation of your request, a root-cause
        hypothesis, a reviewer&apos;s concern — it is labelled as such and kept separate from executed fact.
        That separation is the entire point: an agent saying &ldquo;done&rdquo; is a claim, and a claim is not
        evidence.
      </p>
    </section>
  );
}
