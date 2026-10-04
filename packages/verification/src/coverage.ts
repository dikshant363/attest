/**
 * Acceptance-criteria coverage.
 *
 * WHY THIS EXISTS
 *
 * This module was written in response to an observed failure of the product's own promise.
 *
 * A live run asked a local open-weight model to add session authentication. The model added a
 * session check to `/api/me`, never created a login route, and left an unreachable duplicate
 * statement behind. The project's five tests all passed — because they tested *existing*
 * behaviour, not the requested behaviour. Typecheck passed. Security passed. The runtime
 * returned `VERIFIED`.
 *
 * Strictly speaking that verdict was accurate: every layer that ran did pass. But a developer
 * reading "VERIFIED" would reasonably conclude the feature had been implemented. It had not.
 * That is precisely the false confidence this project exists to prevent, produced by this
 * project. The verification engine was honest and the *product* was still misleading.
 *
 * The root cause is not a bug in the verdict function. It is that the verdict answered
 * "did the checks pass?" while the developer was asking "did you do what I asked?".
 *
 * So this module asks the second question, mechanically: for each acceptance criterion, is
 * there anything in the repository's test files that exercises it? A criterion that names a
 * concrete surface — a route, a quoted literal — and is referenced by no test is reported as
 * uncovered, and the verdict is capped at PARTIALLY_VERIFIED.
 *
 * DELIBERATE LIMITS
 *
 * This is a heuristic, and it is presented as one. It reasons about whether a test *mentions*
 * the surface, not whether the test is any good. It can be satisfied by a test that asserts
 * nothing. It is a smoke alarm, not a fire-suppression system — and a smoke alarm that says
 * "nothing here tests the route you just added" is worth having.
 */

export interface CriteriaCoverage {
  criterion: string;
  /** True when at least one extracted signal appeared in a test file. */
  covered: boolean;
  /** Signals looked for, best-effort. */
  signals: string[];
  /** Which of those were found. */
  matchedSignals: string[];
  /**
   * True when the criterion names something concrete enough to test — a route, or a quoted
   * literal. Only concrete criteria are allowed to cap the verdict; a vague criterion would
   * otherwise downgrade every run and the signal would be worthless.
   */
  concrete: boolean;
}

export interface CoverageReport {
  results: CriteriaCoverage[];
  uncoveredConcrete: string[];
  coveredCount: number;
  /** True when no test files exist at all, so coverage cannot be assessed. */
  unassessable: boolean;
}

/**
 * Does this path look like a test file?
 *
 * Needed because the Project World's test-file list is captured at analysis time, and an
 * agent adding a test for the behaviour it just built is the *common* case rather than an
 * edge case. Without this, the coverage check would ignore the very tests that satisfy it.
 */
export function looksLikeTestFile(relPath: string): boolean {
  return (
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(relPath) ||
    /(^|\/)(tests?|__tests__)\//.test(relPath) ||
    /(^|\/)test_.*\.py$/.test(relPath) ||
    /_test\.py$/.test(relPath) ||
    /_test\.go$/.test(relPath)
  );
}

/**
 * A quoted literal that is really a shell command, not a surface to be tested.
 *
 * Observed false positive: an acceptance criterion reading "Running `npm run test` must pass"
 * was flagged as uncovered, because no *test file* contained the string "npm run test". But
 * that criterion is satisfied by the verification layer running the command. Flagging it
 * would have taught developers to ignore this check.
 */
const COMMAND_LIKE =
  /^(npm|pnpm|yarn|bun|npx|node|deno|python3?|pip|poetry|make|cargo|go|mvn|gradle|pytest|vitest|jest|tsc|eslint|biome|docker)\b/i;

const STOPWORDS = new Set([
  "that", "this", "with", "from", "when", "then", "than", "they", "them", "their", "there",
  "which", "while", "would", "should", "could", "must", "have", "has", "had", "been", "being",
  "into", "onto", "over", "under", "about", "after", "before", "between", "because", "without",
  "return", "returns", "returning", "make", "makes", "made", "sure", "still", "keep", "keeps",
  "keeping", "work", "works", "working", "user", "users", "session", "sessions", "request",
  "requests", "response", "responses", "route", "routes", "endpoint", "application", "app",
  "existing", "behaviour", "behavior", "continue", "continues", "remain", "remains", "reachable",
  "without", "allow", "allows", "accept", "accepts", "valid", "invalid", "establish",
  "establishes", "auth", "authentication", "authenticated", "authorization", "code", "test",
  "tests", "must", "should", "the", "and", "for", "not", "any", "all", "one", "two",
  "run", "runs", "running", "pass", "passes", "passing", "passed", "command", "commands",
  "confirm", "confirms", "confirming", "confirmed", "suite", "suites", "check", "checks",
]);

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/** Extract the concrete things a criterion talks about. */
export function extractSignals(criterion: string): { signals: string[]; concrete: boolean } {
  const signals = new Set<string>();
  let concrete = false;

  // 1. HTTP routes — the strongest signal that a criterion names a surface.
  for (const m of criterion.matchAll(/\/(?:[A-Za-z0-9_.:-]+\/?)+/g)) {
    const route = m[0].replace(/[.,;:]$/, "");
    // A bare "/" or a filesystem-looking path with an extension is not an HTTP route.
    if (route.length >= 3 && !/\.[a-z]{2,4}$/i.test(route)) {
      signals.add(route);
      concrete = true;
    }
  }

  // 2. Quoted literals: the author is pointing at an exact string. Shell commands are
  //    excluded — they are satisfied by a verification layer running them, not by a test
  //    mentioning them.
  for (const m of criterion.matchAll(/[`"']([^`"']{3,60})[`"']/g)) {
    const literal = m[1]!.trim();
    if (literal.length < 3) continue;
    if (COMMAND_LIKE.test(literal) || /\srun\s/.test(literal)) continue;
    signals.add(literal);
    concrete = true;
  }

  // 3. Distinctive identifiers. Long, camelCase, snake_case, or containing a digit — the
  //    shapes that mean "a specific symbol" rather than ordinary prose.
  for (const m of criterion.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{4,})\b/g)) {
    const word = m[1]!;
    const lower = word.toLowerCase();
    if (HTTP_METHODS.has(lower)) continue;
    if (STOPWORDS.has(lower)) continue;
    const distinctive = /[A-Z]/.test(word.slice(1)) || word.includes("_") || /\d/.test(word);
    if (distinctive) signals.add(word);
  }

  return { signals: [...signals], concrete };
}

/**
 * Assess whether the repository's tests exercise each acceptance criterion.
 *
 * `readTestFile` is injected so this stays pure and testable.
 */
export interface CoverageOptions {
  /**
   * The commands the project declares and the verification engine executes. A criterion that
   * names one of these is exercised by the layer that runs it, so it is covered by definition.
   */
  knownCommands?: string[];
}

export function assessAcceptanceCoverage(
  criteria: string[],
  testFiles: string[],
  readTestFile: (path: string) => string | undefined,
  options: CoverageOptions = {},
): CoverageReport {
  if (testFiles.length === 0) {
    return { results: [], uncoveredConcrete: [], coveredCount: 0, unassessable: true };
  }

  // Concatenate the searchable text once. Signals are searched case-insensitively because
  // test names and identifiers vary in case between the criterion and the test.
  const haystack = testFiles
    .map((f) => readTestFile(f) ?? "")
    .join("\n")
    .toLowerCase();

  const knownCommands = (options.knownCommands ?? []).filter((c) => c.trim().length > 0);

  const results: CriteriaCoverage[] = criteria.map((criterion) => {
    // A criterion that names a command the project declares is satisfied by the layer that
    // runs it. It is marked covered and explicitly NOT concrete, so it can never cap the
    // verdict on the strength of the command not appearing in a test file.
    const lower = criterion.toLowerCase();
    const namedCommands = knownCommands.filter((c) => lower.includes(c.toLowerCase()));
    if (namedCommands.length > 0) {
      return {
        criterion,
        covered: true,
        signals: namedCommands,
        matchedSignals: namedCommands,
        concrete: false,
      };
    }

    const { signals, concrete } = extractSignals(criterion);
    const matchedSignals = signals.filter((s) => haystack.includes(s.toLowerCase()));
    return {
      criterion,
      // A criterion with no extractable signals is treated as covered rather than uncovered:
      // we will not accuse a change of missing something we could not parse.
      covered: signals.length === 0 ? true : matchedSignals.length > 0,
      signals,
      matchedSignals,
      concrete: concrete && signals.length > 0,
    };
  });

  return {
    results,
    uncoveredConcrete: results.filter((r) => !r.covered && r.concrete).map((r) => r.criterion),
    coveredCount: results.filter((r) => r.covered).length,
    unassessable: false,
  };
}
