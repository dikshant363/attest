import path from "node:path";
import type { PermissionLevel } from "@attest/shared";

/** Everything a tool is allowed to know about the world it is mutating. */
export interface ToolContext {
  root: string;
  taskId?: string;
  executionId?: string;
  /** When false, mutating tools refuse to run. Used by `--dry-run` and read-only commands. */
  allowWrite: boolean;
  /** When false, no process is spawned. Verification layers still run via the runtime's own path. */
  allowExecute?: boolean;
  /**
   * Destructive tools (delete_file) require this. It is off by default so that an
   * autonomous run cannot remove files without a human opting in for that run.
   */
  allowDangerous?: boolean;
  /** When true, mutating tools report what they would do without touching disk. */
  dryRun: boolean;
  /** Hard ceiling for any single tool call. */
  timeoutMs?: number;
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_INPUT"
      | "PERMISSION_DENIED"
      | "PATH_ESCAPE"
      | "NOT_FOUND"
      | "TIMEOUT"
      | "EXECUTION_FAILED",
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  permission: PermissionLevel;
  /** True when this tool can change the workspace. */
  mutating: boolean;
  /** Explicit input contract. The runtime validates before executing. */
  inputSchema: { parse: (v: unknown) => I; safeParse: (v: unknown) => { success: boolean; data?: I; error?: unknown } };
  /** Optional semantic preconditions (e.g. file must exist). */
  precondition?: (input: I, ctx: ToolContext) => Promise<string | undefined>;
  execute: (input: I, ctx: ToolContext) => Promise<O>;
  timeoutMs: number;
}

/**
 * Resolve a caller-supplied path inside the workspace root, refusing escapes.
 *
 * This is the single chokepoint for filesystem safety. A model that emits
 * `../../etc/passwd` or an absolute path outside the project is rejected before
 * any I/O happens, and the rejection is audited.
 */
export function resolveInsideRoot(root: string, candidate: string): string {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new ToolError("path must be a non-empty string", "INVALID_INPUT");
  }
  if (candidate.includes("\0")) {
    throw new ToolError("path contains a NUL byte", "INVALID_INPUT");
  }
  const absRoot = path.resolve(root);
  const resolved = path.resolve(absRoot, candidate);
  const rel = path.relative(absRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ToolError(
      `path escapes the project root: ${candidate}`,
      "PATH_ESCAPE",
      { candidate, resolved, root: absRoot },
    );
  }
  return resolved;
}

/** Paths the runtime never writes to, regardless of who asks. */
const PROTECTED_SEGMENTS = [".git/", ".attest/"];

export function assertWritableInsideRoot(root: string, candidate: string): string {
  const abs = resolveInsideRoot(root, candidate);
  const rel = path.relative(path.resolve(root), abs).split(path.sep).join("/");
  for (const seg of PROTECTED_SEGMENTS) {
    if (rel === seg.replace(/\/$/, "") || rel.startsWith(seg)) {
      throw new ToolError(
        `refusing to write inside protected path "${seg}"`,
        "PERMISSION_DENIED",
        { path: rel },
      );
    }
  }
  return abs;
}
