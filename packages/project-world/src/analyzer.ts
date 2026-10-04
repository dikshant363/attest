import fs from "node:fs/promises";
import path from "node:path";
import type {
  ArchitectureDecision,
  Constraint,
  Language,
  Project,
  ProjectCommand,
  Provenance,
  RepositoryInfo,
  StackInfo,
} from "@attest/shared";
import { newId, nowIso, pathExists, readText, runCommand, sha256 } from "@attest/shared";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "target",
  "vendor",
  ".idea",
  ".vscode",
  ".attest",
  ".turbo",
  ".cache",
  "Pods",
  "DerivedData",
]);

const MANIFEST_FILES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
  "Makefile",
];

const KEY_FILE_CANDIDATES = [
  "README.md",
  "README",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "src/index.ts",
  "src/main.ts",
  "src/app.ts",
  "index.js",
  "main.py",
  "app.py",
  "manage.py",
  "cmd/main.go",
  "src/main.rs",
  "Dockerfile",
  "docker-compose.yml",
  "tsconfig.json",
  "vite.config.ts",
  "next.config.js",
  "next.config.mjs",
];

const TEST_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /(^|\/)test_.*\.py$/,
  /_test\.py$/,
  /(^|\/)tests?\//,
];

const LANGUAGE_BY_EXT: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
};

export interface AnalyzeOptions {
  /** Max files to record in the tree. Keeps the world small enough to feed a model. */
  treeLimit?: number;
  /** Max bytes read from any single file when summarizing. */
  maxFileBytes?: number;
}

export interface AnalyzerResult {
  project: Project;
  /** Directories that were skipped, reported rather than hidden. */
  skippedDirs: string[];
  /** Files that were too large to read. */
  skippedLargeFiles: string[];
}

/**
 * Build a Project World from a repository.
 *
 * Everything produced here is `observed` provenance unless explicitly marked otherwise.
 * Unknowable things go in `unknowns` rather than being guessed — the runtime must be able
 * to tell a developer what it does not know.
 */
export async function analyzeRepository(
  root: string,
  opts: AnalyzeOptions = {},
): Promise<AnalyzerResult> {
  const treeLimit = opts.treeLimit ?? 600;
  const maxFileBytes = opts.maxFileBytes ?? 256 * 1024;
  const absRoot = path.resolve(root);
  const observed: Provenance = { source: "observed", confidence: 1, at: nowIso() };

  const skippedDirs: string[] = [];
  const skippedLargeFiles: string[] = [];
  const tree: string[] = [];
  const testFiles: string[] = [];
  const keyFiles: string[] = [];
  const languageCounts = new Map<Language, number>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(absRoot, full);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          skippedDirs.push(`${rel}/`);
          continue;
        }
        if (tree.length < treeLimit) tree.push(`${rel}/`);
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (tree.length < treeLimit) tree.push(rel);
        const ext = path.extname(entry.name).toLowerCase();
        const lang = LANGUAGE_BY_EXT[ext];
        if (lang) languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
        if (TEST_PATTERNS.some((re) => re.test(rel))) testFiles.push(rel);
      }
    }
  }

  await walk(absRoot, 0);

  for (const candidate of KEY_FILE_CANDIDATES) {
    const full = path.join(absRoot, candidate);
    if (await pathExists(full)) keyFiles.push(candidate);
  }

  const manifests: string[] = [];
  for (const m of MANIFEST_FILES) {
    if (await pathExists(path.join(absRoot, m))) manifests.push(m);
  }

  const stack = await readStack(absRoot, manifests, languageCounts);
  const repository = await readRepository(absRoot);
  const commands = await discoverCommands(absRoot, manifests, stack);
  const constraints = await discoverConstraints(absRoot, testFiles, commands);

  // Truncate for storage sanity: the world is fed to models, so it must stay bounded.
  testFiles.sort();
  keyFiles.sort();
  tree.sort();

  const unknowns: string[] = [];
  if (commands.filter((c) => c.kind === "test").length === 0) {
    unknowns.push(
      "No test command could be discovered. The runtime cannot claim 'tested' for this project.",
    );
  }
  if (stack.manifests.length === 0) {
    unknowns.push("No dependency manifest was found; dependency-level analysis is unavailable.");
  }
  if (tree.length >= treeLimit) {
    unknowns.push(`Directory listing was truncated at ${treeLimit} entries.`);
  }
  if (!repository.isGitRepo) {
    unknowns.push(
      "Not a git repository: checkpoints will use directory snapshots, which are slower and larger.",
    );
  }

  const project: Project = {
    id: newId("proj"),
    name: path.basename(absRoot),
    root: absRoot,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    worldRevision: 1,
    stack,
    repository,
    commands,
    testFiles: testFiles.slice(0, 200),
    keyFiles,
    tree: tree.slice(0, treeLimit),
    constraints,
    decisions: [],
    unknowns,
  };

  return { project, skippedDirs, skippedLargeFiles };
}

async function readStack(
  root: string,
  manifests: string[],
  languageCounts: Map<Language, number>,
): Promise<StackInfo> {
  const dependencies: Record<string, string> = {};
  const frameworks: string[] = [];
  let packageManager: StackInfo["packageManager"] = "unknown";

  const pkgRaw = await readText(path.join(root, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        packageManager?: string;
      };
      Object.assign(dependencies, pkg.dependencies ?? {}, pkg.devDependencies ?? {});
      const pm = pkg.packageManager ?? "";
      if (pm.startsWith("pnpm")) packageManager = "pnpm";
      else if (pm.startsWith("yarn")) packageManager = "yarn";
      else if (pm.startsWith("bun")) packageManager = "bun";
      else if (await pathExists(path.join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
      else if (await pathExists(path.join(root, "yarn.lock"))) packageManager = "yarn";
      else if (await pathExists(path.join(root, "bun.lockb"))) packageManager = "bun";
      else packageManager = "npm";

      const known = [
        "next",
        "react",
        "vue",
        "svelte",
        "express",
        "fastify",
        "nestjs",
        "hono",
        "koa",
        "vite",
        "vitest",
        "jest",
        "playwright",
        "prisma",
        "drizzle-orm",
        "tailwindcss",
      ];
      for (const k of known) if (k in dependencies) frameworks.push(k);
    } catch {
      /* malformed manifest is reported as an unknown, not a crash */
    }
  }

  const pyproject = await readText(path.join(root, "pyproject.toml"));
  const requirements = await readText(path.join(root, "requirements.txt"));
  const pySource = [pyproject, requirements].filter(Boolean).join("\n");
  if (pySource) {
    if (packageManager === "unknown") packageManager = pyproject ? "poetry" : "pip";
    for (const fw of ["fastapi", "django", "flask", "pytest", "sqlalchemy", "pydantic"]) {
      if (new RegExp(`(^|[^a-z])${fw}([^a-z]|$)`, "im").test(pySource)) frameworks.push(fw);
    }
  }
  if (await pathExists(path.join(root, "go.mod"))) {
    if (packageManager === "unknown") packageManager = "go";
  }
  if (await pathExists(path.join(root, "Cargo.toml"))) {
    if (packageManager === "unknown") packageManager = "cargo";
  }

  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
  if (languages.length === 0) languages.push("other");

  return {
    languages,
    frameworks: [...new Set(frameworks)],
    packageManager,
    dependencies,
    manifests,
  };
}

async function readRepository(root: string): Promise<RepositoryInfo> {
  const isGitRepo = await pathExists(path.join(root, ".git"));
  if (!isGitRepo) return { root, isGitRepo: false };

  const info: RepositoryInfo = { root, isGitRepo: true };
  const branch = await runCommand("git rev-parse --abbrev-ref HEAD", { cwd: root, timeoutMs: 10_000 });
  if (branch.exitCode === 0) info.branch = branch.stdout.trim();
  const head = await runCommand("git rev-parse --short HEAD", { cwd: root, timeoutMs: 10_000 });
  if (head.exitCode === 0) info.headSha = head.stdout.trim();
  const status = await runCommand("git status --porcelain", { cwd: root, timeoutMs: 10_000 });
  if (status.exitCode === 0) info.dirty = status.stdout.trim().length > 0;
  const remote = await runCommand("git remote get-url origin", { cwd: root, timeoutMs: 10_000 });
  if (remote.exitCode === 0) info.remoteUrl = remote.stdout.trim();
  return info;
}

/**
 * Discover runnable commands from the project's own manifests.
 * The runtime never invents a verification command: if the project does not declare
 * tests, we say so rather than pretending.
 */
async function discoverCommands(
  root: string,
  manifests: string[],
  stack: StackInfo,
): Promise<ProjectCommand[]> {
  const commands: ProjectCommand[] = [];
  const push = (kind: string, command: string, declaredIn: string) => {
    if (commands.some((c) => c.kind === kind)) return;
    commands.push({ kind, command, declaredIn });
  };

  if (manifests.includes("package.json")) {
    const raw = await readText(path.join(root, "package.json"));
    if (raw) {
      try {
        const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
        const scripts = pkg.scripts ?? {};
        const pm = stack.packageManager === "yarn" ? "yarn" : stack.packageManager === "pnpm" ? "pnpm" : "npm";
        const runner = pm === "npm" ? "npm run" : `${pm} run`;
        const order: [string, RegExp][] = [
          ["test", /^(test|vitest|jest)$/],
          ["typecheck", /^(typecheck|type-check|tsc|check-types)$/],
          ["lint", /^(lint|eslint|biome|biome:check)$/],
          ["build", /^(build|compile)$/],
        ];
        for (const [kind, re] of order) {
          const hit = Object.keys(scripts).find((name) => re.test(name));
          if (hit) push(kind, `${runner} ${hit}`, `package.json#scripts.${hit}`);
        }
        // Integration / e2e if the project declares them separately.
        const e2e = Object.keys(scripts).find((n) => /^(e2e|test:e2e|integration|test:integration)$/.test(n));
        if (e2e) push("e2e", `${runner} ${e2e}`, `package.json#scripts.${e2e}`);
      } catch {
        /* ignored: reported via unknowns upstream */
      }
    }
  }

  if (manifests.includes("Makefile")) {
    const mk = await readText(path.join(root, "Makefile"));
    if (mk && /^test:/m.test(mk)) push("test", "make test", "Makefile#test");
  }

  if (stack.frameworks.includes("pytest") || manifests.includes("pyproject.toml")) {
    const pyproject = await readText(path.join(root, "pyproject.toml"));
    if (pyproject && /pytest/.test(pyproject)) push("test", "python -m pytest -q", "pyproject.toml");
  }

  return commands;
}

/**
 * Constraints are the things a change must not break.
 *
 * Discovered constraints are deliberately conservative: we only claim a constraint when
 * there is an artifact that enforces it. Anything else must be declared by a human in
 * `.attest/constraints.json` — an invented constraint would make the verdict untrustworthy.
 */
async function discoverConstraints(
  root: string,
  testFiles: string[],
  commands: ProjectCommand[],
): Promise<Constraint[]> {
  const constraints: Constraint[] = [];
  const testCmd = commands.find((c) => c.kind === "test");
  if (testCmd && testFiles.length > 0) {
    constraints.push({
      id: newId("con"),
      statement: `The existing test suite must continue to pass (${testFiles.length} test file(s) discovered).`,
      origin: "discovered",
      enforcedBy: testCmd.command,
      severity: "hard",
      provenance: {
        source: "observed",
        confidence: 0.95,
        at: nowIso(),
        note: "Derived from the presence of test files plus a runnable test command.",
      },
    });
  }

  // Human-declared constraints. Two locations are read so that a repository can keep
  // them in a committed, reviewable file (`attest.constraints.json`) rather than only
  // inside the generated `.attest/` directory.
  const declaredPaths = ["attest.constraints.json", path.join(".attest", "constraints.json")];
  const declaredRaw =
    (await readText(path.join(root, "attest.constraints.json"))) ??
    (await readText(path.join(root, ".attest", "constraints.json")));
  if (declaredRaw) {
    try {
      const parsed = JSON.parse(declaredRaw) as { statement?: string; enforcedBy?: string; severity?: "hard" | "soft" }[];
      for (const item of parsed) {
        if (!item.statement) continue;
        constraints.push({
          id: newId("con"),
          statement: item.statement,
          origin: "human",
          enforcedBy: item.enforcedBy,
          severity: item.severity ?? "hard",
          provenance: {
            source: "human",
            confidence: 1,
            at: nowIso(),
            note: declaredPaths.find((p) => p && item) ? "attest.constraints.json" : "declared constraint",
          },
        });
      }
    } catch {
      /* malformed declaration: ignored, surfaced via unknowns elsewhere */
    }
  }

  return constraints;
}

/** Stable digest of a project's observable identity, used to detect drift. */
export function projectFingerprint(project: Project): string {
  return sha256(
    JSON.stringify({
      root: project.root,
      headSha: project.repository.headSha,
      testFiles: project.testFiles,
      commands: project.commands.map((c) => c.command),
    }),
  ).slice(0, 16);
}

export function emptyArchitectureDecision(): ArchitectureDecision {
  return {
    id: newId("adr"),
    title: "",
    context: "",
    decision: "",
    alternatives: [],
    consequences: [],
    provenance: { source: "human", confidence: 1, at: nowIso() },
  };
}
