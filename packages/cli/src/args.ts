export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Minimal, dependency-free argument parser.
 *
 * Deliberately hand-rolled: the CLI is the primary demo surface, and a parser we fully
 * control cannot change behaviour under us mid-recording. Unknown flags are rejected
 * rather than ignored, so a typo never silently changes what the runtime does.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[body] = next;
        i++;
      } else {
        flags[body] = true;
      }
    } else if (token.startsWith("-") && token.length > 1) {
      const body = token.slice(1);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[body] = next;
        i++;
      } else {
        flags[body] = true;
      }
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

export function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

export function flagBool(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}

export function flagNumber(flags: Record<string, string | boolean>, name: string, fallback: number): number {
  const v = flags[name];
  if (typeof v !== "string") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const KNOWN_FLAGS: Record<string, string[]> = {
  init: ["force", "json", "dir"],
  analyze: ["json", "dir"],
  task: [
    "max-attempts",
    "dry-run",
    "yes-dangerous",
    "no-review",
    "inject-regression",
    "json",
    "dir",
    "timeout",
    "offline",
  ],
  status: ["json", "dir"],
  tasks: ["json", "dir"],
  evidence: ["markdown", "diff", "export", "json", "dir"],
  verify: ["evidence", "json", "dir"],
  explain: ["json", "dir"],
  rollback: ["task", "checkpoint", "json", "dir"],
  checkpoints: ["json", "dir"],
  models: ["probe", "json", "dir", "why"],
  tools: ["json", "dir"],
  audit: ["limit", "json", "dir"],
  decision: ["context", "decision", "alternatives", "consequences", "json", "dir"],
  demo: ["dir", "json", "no-review", "yes-dangerous"],
  help: [],
  version: [],
};

export function validateFlags(command: string, flags: Record<string, string | boolean>): string[] {
  const known = KNOWN_FLAGS[command];
  if (!known) return [];
  const unknown = Object.keys(flags).filter((f) => !known.includes(f) && !["h", "help"].includes(f));
  return unknown.map((f) => `unknown flag --${f} for command "${command}"`);
}
