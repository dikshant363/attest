import { z } from "zod";
import { runCommand, truncate } from "@attest/shared";
import type { ToolContext, ToolDefinition } from "../types.ts";

const GitStatusInput = z.object({});

export const gitStatusTool: ToolDefinition<
  z.infer<typeof GitStatusInput>,
  { isRepo: boolean; branch?: string; head?: string; porcelain: string; dirty: boolean }
> = {
  name: "git_status",
  description: "Show the repository branch, HEAD commit, and uncommitted changes.",
  permission: "read",
  mutating: false,
  inputSchema: GitStatusInput,
  timeoutMs: 20_000,
  async execute(_input, ctx) {
    const branch = await runCommand("git rev-parse --abbrev-ref HEAD", { cwd: ctx.root, timeoutMs: 10_000 });
    if (branch.exitCode !== 0) {
      return { isRepo: false, porcelain: "", dirty: false };
    }
    const head = await runCommand("git rev-parse --short HEAD", { cwd: ctx.root, timeoutMs: 10_000 });
    const status = await runCommand("git status --porcelain", { cwd: ctx.root, timeoutMs: 10_000 });
    return {
      isRepo: true,
      branch: branch.stdout.trim(),
      head: head.exitCode === 0 ? head.stdout.trim() : undefined,
      porcelain: truncate(status.stdout, 8000),
      dirty: status.stdout.trim().length > 0,
    };
  },
};

const GitDiffInput = z.object({
  /** Diff against this ref. Defaults to the working tree vs HEAD. */
  ref: z.string().optional(),
  path: z.string().optional(),
});

export const gitDiffTool: ToolDefinition<
  z.infer<typeof GitDiffInput>,
  { diff: string; truncated: boolean }
> = {
  name: "git_diff",
  description: "Show the current diff, optionally scoped to a path or a ref.",
  permission: "read",
  mutating: false,
  inputSchema: GitDiffInput,
  timeoutMs: 30_000,
  async execute(input, ctx) {
    const parts = ["git diff", "--no-color"];
    if (input.ref) parts.push(input.ref);
    if (input.path) parts.push("--", input.path);
    const res = await runCommand(parts.join(" "), { cwd: ctx.root, timeoutMs: 25_000 });
    const raw = res.stdout;
    return { diff: truncate(raw, 40_000), truncated: raw.length > 40_000 };
  },
};
