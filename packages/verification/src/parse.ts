/**
 * Parsers for real test-runner output.
 *
 * We read counts out of the runner's own summary rather than guessing, so the evidence
 * record can say "12 passed, 1 failed" instead of "command exited non-zero".
 */

export interface ParsedCounts {
  passed?: number;
  failed?: number;
  total?: number;
  /** Names of failing tests / assertions, best effort, for diagnosis. */
  failures: string[];
  /** Which runner was recognised. */
  runner?: string;
}

export function parseTestOutput(stdout: string, stderr: string): ParsedCounts {
  const text = `${stdout}\n${stderr}`;
  const failures: string[] = [];
  let passed: number | undefined;
  let failed: number | undefined;
  let total: number | undefined;
  let runner: string | undefined;

  // node:test TAP summary: "# tests 5 / # pass 5 / # fail 0"
  const nodetest = text.match(/# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/);
  if (nodetest) {
    runner = "node:test";
    total = Number(nodetest[1]);
    passed = Number(nodetest[2]);
    failed = Number(nodetest[3]);
  }

  // vitest: " Tests  12 passed (12)" / " Tests  1 failed | 11 passed (12)"
  const vitest = text.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/);
  if (!runner && vitest) {
    runner = "vitest";
    failed = vitest[1] ? Number(vitest[1]) : 0;
    passed = Number(vitest[2]);
    total = Number(vitest[3]);
  }

  // jest: "Tests:       1 failed, 11 passed, 12 total"
  if (!runner) {
    const jest = text.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed,\s*(\d+)\s+total/);
    if (jest) {
      runner = "jest";
      failed = jest[1] ? Number(jest[1]) : 0;
      passed = Number(jest[3]);
      total = Number(jest[4]);
    }
  }

  // pytest: "12 passed, 1 failed in 0.42s"
  if (!runner) {
    const pytest = text.match(/(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed)(?:,\s*(\d+)\s+error)?/);
    if (pytest && /passed|failed/i.test(text)) {
      runner = "pytest";
      failed = pytest[1] ? Number(pytest[1]) : 0;
      passed = Number(pytest[2]);
      total = (failed ?? 0) + (passed ?? 0);
    }
  }

  // go test: "ok" / "FAIL" per package, plus "--- FAIL: TestX"
  if (!runner && /^(ok|FAIL|---\s+FAIL|\?\s+)/m.test(text) && /go test|go\.mod|_test\.go/m.test(text)) {
    runner = "go test";
    const failMatches = [...text.matchAll(/---\s+FAIL:\s+(\S+)/g)].map((m) => m[1]!);
    failures.push(...failMatches);
    failed = failMatches.length;
  }

  // Generic failure extraction, used regardless of runner.
  // TAP "not ok N - <name>" is the highest-signal form, so it is collected first.
  const tapFailures = [...text.matchAll(/^\s*not ok \d+ - (.+?)\s*$/gm)].map((m) => m[1]!.trim());
  for (const t of tapFailures) {
    if (t && !failures.includes(t) && failures.length < 20) failures.push(t);
  }

  const generic = [
    ...text.matchAll(/^\s*(?:×|✕|✗|FAIL|not ok|AssertionError|\s*✘)\s*:?\s*(.{0,160})$/gm),
  ].map((m) => m[1]!.trim());
  for (const g of generic) {
    if (g && !failures.includes(g) && failures.length < 20) failures.push(g);
  }

  // vitest lists failing test names with a leading "×" or "FAIL" block.
  const vitestFailNames = [...text.matchAll(/^\s*(?:×|FAIL)\s+(.+?)(?:\s+\d+ms)?$/gm)].map((m) => m[1]!.trim());
  for (const n of vitestFailNames) {
    if (n && !failures.includes(n) && failures.length < 20) failures.push(n);
  }

  // Assertion messages, the most useful signal for a diagnosis model.
  const assertion = [...text.matchAll(/AssertionError[:\s]*(.{0,200})/g)].map((m) => m[1]!.trim()).filter(Boolean);
  for (const a of assertion) {
    if (!failures.includes(a) && failures.length < 20) failures.push(a);
  }

  return { passed, failed, total, failures, runner };
}

/** Extract a compact, high-signal failure excerpt suitable for a diagnostic prompt. */
export function failureExcerpt(stdout: string, stderr: string, max = 4000): string {
  const raw = `${stdout}\n${stderr}`;
  const lines = raw.split("\n");

  // Prefer the TAP failure blocks: "not ok ..." plus the diagnostic YAML that follows.
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*not ok \d+/.test(lines[i]!)) {
      out.push(lines[i]!.trim());
      // take up to 18 following lines of diagnostic detail
      for (let j = i + 1; j < Math.min(lines.length, i + 19); j++) {
        const l = lines[j]!;
        if (/^\s*(ok|not ok) \d+/.test(l)) break;
        if (l.trim()) out.push(l.replace(/^\s+/, "  "));
      }
    }
  }
  if (out.length) return out.join("\n").slice(0, max);

  const interesting = lines.filter((l) =>
    /(error|fail|assert|expected|received|mismatch|cannot|unexpected|Error:|✕|×)/i.test(l),
  );
  const chosen = (interesting.length > 3 ? interesting : lines).join("\n");
  return chosen.slice(0, max);
}
