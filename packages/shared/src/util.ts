import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Ids & hashing
// ---------------------------------------------------------------------------

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short, sortable-ish, human-copyable id: prefix_<time36><rand>. */
export function newId(prefix: string): string {
  const ts = Date.now().toString(36);
  let rand = "";
  const bytes = randomUUID().replace(/-/g, "");
  for (let i = 0; i < 6; i++) {
    rand += ALPHABET[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % 36];
  }
  return `${prefix}_${ts}${rand}`;
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(input: string | Buffer, len = 10): string {
  return sha256(input).slice(0, len);
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Atomic JSON write: write to a temp file in the same directory, then rename.
 * Prevents a crash mid-write from corrupting the project world.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

export async function hashFile(file: string): Promise<string | undefined> {
  try {
    const buf = await fs.readFile(file);
    return sha256(buf);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Truncation — storage sanity. Full output stays in the run log.
// ---------------------------------------------------------------------------

export function truncate(s: string, max = 8000): string {
  if (s.length <= max) return s;
  const head = s.slice(0, Math.floor(max * 0.7));
  const tail = s.slice(-Math.floor(max * 0.2));
  return `${head}\n\n… [${s.length - head.length - tail.length} chars truncated] …\n\n${tail}`;
}

export function boundJson(value: unknown, max = 4000): unknown {
  try {
    const s = JSON.stringify(value);
    if (s === undefined) return value;
    if (s.length <= max) return value;
    return { _truncated: true, _originalLength: s.length, preview: truncate(s, max) };
  } catch {
    return { _unserializable: true };
  }
}

// ---------------------------------------------------------------------------
// Process execution — no shell interpolation of model output.
// ---------------------------------------------------------------------------

export interface RunResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Run a command declared by the project (package.json script, etc).
 * Uses the shell because these are developer-authored command lines, but the
 * command string always originates from a manifest or an explicit plan step that
 * human review can see — never from raw model text applied without a plan.
 */
export function runCommand(
  command: string,
  opts: { cwd: string; timeoutMs?: number; env?: Record<string, string> } = { cwd: process.cwd() },
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(
      process.env.SHELL || "/bin/sh",
      ["-c", command],
      {
        cwd: opts.cwd,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ...(opts.env ?? {}), CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - started;
        const anyErr = err as (Error & { code?: number | string; killed?: boolean }) | null;
        let exitCode = 0;
        if (anyErr) {
          if (typeof anyErr.code === "number") exitCode = anyErr.code;
          else if (anyErr.killed) exitCode = 124;
          else exitCode = 1;
        }
        resolve({
          command,
          exitCode,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          durationMs,
          timedOut: Boolean(anyErr?.killed),
        });
      },
    );
    child.on("error", () => {
      resolve({
        command,
        exitCode: 127,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Diffing — a tiny, dependency-free unified diff for evidence records.
// ---------------------------------------------------------------------------

/** Line-level LCS diff, adequate for the small, human-reviewed diffs we store. */
export function unifiedDiff(
  before: string,
  after: string,
  opts: { path?: string; context?: number } = {},
): string {
  const ctx = opts.context ?? 3;
  const a = before.length ? before.split("\n") : [];
  const b = after.length ? after.split("\n") : [];
  const header = `--- a/${opts.path ?? "file"}\n+++ b/${opts.path ?? "file"}`;

  if (a.length * b.length > 4_000_000) {
    return `${header}\n@@ (file too large for inline diff; ${a.length} -> ${b.length} lines) @@`;
  }

  // LCS table
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }

  type Op = { t: " " | "-" | "+"; line: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: " ", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ t: "-", line: a[i]! });
      i++;
    } else {
      ops.push({ t: "+", line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ t: "-", line: a[i++]! });
  while (j < m) ops.push({ t: "+", line: b[j++]! });

  // Emit hunks with context
  const out: string[] = [];
  let k = 0;
  let aLine = 1;
  let bLine = 1;
  while (k < ops.length) {
    // find next change
    let start = -1;
    for (let x = k; x < ops.length; x++) {
      if (ops[x]!.t !== " ") {
        start = x;
        break;
      }
    }
    if (start === -1) break;
    const hunkStart = Math.max(0, start - ctx);
    // advance aLine/bLine to hunkStart
    for (let x = k; x < hunkStart; x++) {
      if (ops[x]!.t !== "+") aLine++;
      if (ops[x]!.t !== "-") bLine++;
    }
    let end = start;
    let lastChange = start;
    while (end < ops.length) {
      if (ops[end]!.t !== " ") lastChange = end;
      if (end - lastChange > ctx * 2) break;
      end++;
    }
    const hunkEnd = Math.min(ops.length, lastChange + ctx + 1);
    const slice = ops.slice(hunkStart, hunkEnd);
    const aCount = slice.filter((o) => o.t !== "+").length;
    const bCount = slice.filter((o) => o.t !== "-").length;
    out.push(`@@ -${aLine},${aCount} +${bLine},${bCount} @@`);
    for (const o of slice) {
      out.push(`${o.t}${o.line}`);
      if (o.t !== "+") aLine++;
      if (o.t !== "-") bLine++;
    }
    k = hunkEnd;
  }

  if (out.length === 0) return "";
  return `${header}\n${out.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function countLines(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

/** Extract the first JSON object/array from a model response that may be wrapped in prose or fences. */
export function extractJson(text: string): unknown | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(text.trim());
  // brace matching scan
  for (const c of candidates) {
    const startIdx = c.search(/[[{]/);
    if (startIdx === -1) continue;
    const openCh = c[startIdx]!;
    const closeCh = openCh === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = startIdx; i < c.length; i++) {
      const ch = c[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === openCh) depth++;
      else if (ch === closeCh) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(c.slice(startIdx, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

export function relativeTo(root: string, p: string): string {
  const rel = path.relative(root, p);
  return rel === "" ? "." : rel;
}
