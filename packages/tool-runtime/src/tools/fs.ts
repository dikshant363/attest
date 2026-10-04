import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { countLines, hashFile, readText, unifiedDiff } from "@attest/shared";
import {
  assertWritableInsideRoot,
  resolveInsideRoot,
  ToolError,
  type ToolDefinition,
  type ToolContext,
} from "../types.ts";

/** Result shape shared by mutating file tools so the runtime can build FileChange records. */
export interface FileMutationResult {
  path: string;
  change: "create" | "modify" | "delete";
  beforeHash?: string;
  afterHash?: string;
  diff?: string;
  added: number;
  removed: number;
  /** False when dryRun prevented the write. */
  applied: boolean;
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

const ReadFileInput = z.object({
  path: z.string().describe("Path relative to the project root"),
  maxBytes: z.number().int().positive().max(2_000_000).optional(),
});

export const readFileTool: ToolDefinition<z.infer<typeof ReadFileInput>, { path: string; content: string; truncated: boolean; lines: number }> = {
  name: "read_file",
  description: "Read a UTF-8 text file inside the project. Returns content and line count.",
  permission: "read",
  mutating: false,
  inputSchema: ReadFileInput,
  timeoutMs: 15_000,
  async execute(input, ctx) {
    const abs = resolveInsideRoot(ctx.root, input.path);
    const content = await readText(abs);
    if (content === undefined) throw new ToolError(`file not found: ${input.path}`, "NOT_FOUND");
    const limit = input.maxBytes ?? 400_000;
    const truncated = content.length > limit;
    return {
      path: input.path,
      content: truncated ? content.slice(0, limit) + "\n… truncated …" : content,
      truncated,
      lines: countLines(content),
    };
  },
};

// ---------------------------------------------------------------------------
// list_files
// ---------------------------------------------------------------------------

const ListFilesInput = z.object({
  dir: z.string().default("."),
  depth: z.number().int().min(1).max(6).default(2),
  limit: z.number().int().min(1).max(2000).default(400),
});

const IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  "coverage",
  ".venv",
  "__pycache__",
  "target",
  ".attest",
  ".turbo",
]);

export const listFilesTool: ToolDefinition<z.infer<typeof ListFilesInput>, { entries: string[]; truncated: boolean }> = {
  name: "list_files",
  description: "List files and directories under a path, bounded by depth and count.",
  permission: "read",
  mutating: false,
  inputSchema: ListFilesInput,
  timeoutMs: 15_000,
  async execute(input, ctx) {
    const start = resolveInsideRoot(ctx.root, input.dir);
    const out: string[] = [];
    async function walk(dir: string, d: number): Promise<void> {
      if (d > input.depth || out.length >= input.limit) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= input.limit) return;
        if (IGNORE.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(ctx.root, full).split(path.sep).join("/");
        out.push(e.isDirectory() ? `${rel}/` : rel);
        if (e.isDirectory()) await walk(full, d + 1);
      }
    }
    await walk(start, 1);
    out.sort();
    return { entries: out, truncated: out.length >= input.limit };
  },
};

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

const SearchInput = z.object({
  pattern: z.string().describe("Regular expression"),
  glob: z.string().optional().describe("Optional substring filter on the file path, e.g. .ts"),
  maxResults: z.number().int().min(1).max(500).default(80),
});

export const searchTool: ToolDefinition<
  z.infer<typeof SearchInput>,
  { matches: { path: string; line: number; text: string }[]; scanned: number }
> = {
  name: "search",
  description: "Regex search across project text files. Returns path, line number and text.",
  permission: "read",
  mutating: false,
  inputSchema: SearchInput,
  timeoutMs: 30_000,
  async execute(input, ctx) {
    let re: RegExp;
    try {
      re = new RegExp(input.pattern, "i");
    } catch (err) {
      throw new ToolError(`invalid regex: ${(err as Error).message}`, "INVALID_INPUT");
    }
    const matches: { path: string; line: number; text: string }[] = [];
    let scanned = 0;
    const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs|json|md|yml|yaml|toml|txt|css|html|sql|sh)$/i;

    async function walk(dir: string, d: number): Promise<void> {
      if (d > 6 || matches.length >= input.maxResults) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (matches.length >= input.maxResults) return;
        if (IGNORE.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full, d + 1);
          continue;
        }
        const rel = path.relative(ctx.root, full).split(path.sep).join("/");
        if (input.glob && !rel.includes(input.glob)) continue;
        if (!TEXT_EXT.test(e.name)) continue;
        const content = await readText(full);
        if (content === undefined || content.length > 400_000) continue;
        scanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i]!)) {
            matches.push({ path: rel, line: i + 1, text: lines[i]!.slice(0, 300) });
            if (matches.length >= input.maxResults) break;
          }
        }
      }
    }
    await walk(path.resolve(ctx.root), 0);
    return { matches, scanned };
  },
};

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

const WriteFileInput = z.object({
  path: z.string(),
  content: z.string(),
  /** Optional guard: refuse if the file's current hash differs. Prevents clobbering. */
  expectedHash: z.string().optional(),
});

export const writeFileTool: ToolDefinition<z.infer<typeof WriteFileInput>, FileMutationResult> = {
  name: "write_file",
  description:
    "Create or overwrite a text file inside the project. Optionally guard with expectedHash.",
  permission: "write",
  mutating: true,
  inputSchema: WriteFileInput,
  timeoutMs: 20_000,
  async execute(input, ctx) {
    if (!ctx.allowWrite) {
      throw new ToolError("writes are disabled for this run", "PERMISSION_DENIED");
    }
    const abs = assertWritableInsideRoot(ctx.root, input.path);
    const before = await readText(abs);
    const beforeHash = before === undefined ? undefined : await hashFile(abs);

    if (input.expectedHash && beforeHash && input.expectedHash !== beforeHash) {
      throw new ToolError(
        `refusing to overwrite ${input.path}: content changed since it was read`,
        "PERMISSION_DENIED",
      );
    }

    const change: "create" | "modify" = before === undefined ? "create" : "modify";
    const diff = before === undefined ? "" : unifiedDiff(before, input.content, { path: input.path });

    if (!ctx.dryRun) {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, input.content, "utf8");
    }

    return {
      path: input.path,
      change,
      beforeHash,
      afterHash: ctx.dryRun ? undefined : await hashFile(abs),
      diff,
      added: countLines(input.content),
      removed: before ? countLines(before) : 0,
      applied: !ctx.dryRun,
    };
  },
};

// ---------------------------------------------------------------------------
// edit_file — exact-string replacement. Chosen over unified-diff parsing because
// small open-weight models produce reliable search/replace far more often than
// syntactically valid diffs. Ambiguity is an error, never a silent guess.
// ---------------------------------------------------------------------------

const EditFileInput = z.object({
  path: z.string(),
  search: z.string().describe("Exact text to find. Must appear exactly once."),
  replace: z.string(),
});

export const editFileTool: ToolDefinition<z.infer<typeof EditFileInput>, FileMutationResult> = {
  name: "edit_file",
  description:
    "Replace an exact, unique substring in a file. Fails loudly if the search text is missing or ambiguous.",
  permission: "write",
  mutating: true,
  inputSchema: EditFileInput,
  timeoutMs: 20_000,
  async execute(input, ctx) {
    if (!ctx.allowWrite) throw new ToolError("writes are disabled for this run", "PERMISSION_DENIED");
    const abs = assertWritableInsideRoot(ctx.root, input.path);
    const before = await readText(abs);
    if (before === undefined) throw new ToolError(`file not found: ${input.path}`, "NOT_FOUND");

    const occurrences = countOccurrences(before, input.search);
    if (occurrences === 0) {
      throw new ToolError(
        `search text not found in ${input.path}. The file may have changed, or the snippet may not match exactly.`,
        "INVALID_INPUT",
      );
    }
    if (occurrences > 1) {
      throw new ToolError(
        `search text appears ${occurrences} times in ${input.path}; it must be unique. Provide more context.`,
        "INVALID_INPUT",
      );
    }

    const after = before.replace(input.search, input.replace);
    const diff = unifiedDiff(before, after, { path: input.path });
    if (!ctx.dryRun) await fs.writeFile(abs, after, "utf8");

    return {
      path: input.path,
      change: "modify",
      beforeHash: await hashFile(abs),
      afterHash: ctx.dryRun ? undefined : await hashFile(abs),
      diff,
      added: countLines(input.replace),
      removed: countLines(input.search),
      applied: !ctx.dryRun,
    };
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ---------------------------------------------------------------------------
// apply_edits — batch of file operations, so one model response can be applied
// atomically from the runtime's perspective (all validated before any write).
// ---------------------------------------------------------------------------

const ApplyEditsInput = z.object({
  edits: z
    .array(
      z.object({
        path: z.string(),
        /** Full replacement content. Mutually exclusive with search/replace. */
        content: z.string().optional(),
        search: z.string().optional(),
        replace: z.string().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const applyEditsTool: ToolDefinition<
  z.infer<typeof ApplyEditsInput>,
  { results: FileMutationResult[] }
> = {
  name: "apply_edits",
  description:
    "Apply a batch of file edits. Each edit is either {path, content} to write a whole file, or {path, search, replace} for a unique exact replacement. All edits are validated before any is written.",
  permission: "write",
  mutating: true,
  inputSchema: ApplyEditsInput,
  timeoutMs: 60_000,
  async execute(input, ctx) {
    if (!ctx.allowWrite) throw new ToolError("writes are disabled for this run", "PERMISSION_DENIED");

    // Phase 1: validate everything. No writes until the whole batch is known-good.
    const planned: { abs: string; path: string; before?: string; after: string; change: "create" | "modify" }[] = [];
    for (const edit of input.edits) {
      const abs = assertWritableInsideRoot(ctx.root, edit.path);
      const before = await readText(abs);
      let after: string;
      if (edit.content !== undefined) {
        after = edit.content;
      } else if (edit.search !== undefined && edit.replace !== undefined) {
        if (before === undefined) {
          throw new ToolError(`edit_file target not found: ${edit.path}`, "NOT_FOUND");
        }
        const n = countOccurrences(before, edit.search);
        if (n !== 1) {
          throw new ToolError(
            `edit on ${edit.path}: search text matched ${n} times (must be exactly 1)`,
            "INVALID_INPUT",
          );
        }
        after = before.replace(edit.search, edit.replace);
      } else {
        throw new ToolError(
          `edit on ${edit.path}: provide either "content" or both "search" and "replace"`,
          "INVALID_INPUT",
        );
      }
      planned.push({ abs, path: edit.path, before, after, change: before === undefined ? "create" : "modify" });
    }

    // Phase 2: apply.
    const results: FileMutationResult[] = [];
    for (const p of planned) {
      if (!ctx.dryRun) {
        await fs.mkdir(path.dirname(p.abs), { recursive: true });
        await fs.writeFile(p.abs, p.after, "utf8");
      }
      results.push({
        path: p.path,
        change: p.change,
        beforeHash: p.before === undefined ? undefined : await hashFile(p.abs),
        afterHash: ctx.dryRun ? undefined : await hashFile(p.abs),
        diff: p.before === undefined ? "" : unifiedDiff(p.before, p.after, { path: p.path }),
        added: countLines(p.after),
        removed: p.before ? countLines(p.before) : 0,
        applied: !ctx.dryRun,
      });
    }
    return { results };
  },
};

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

const DeleteFileInput = z.object({ path: z.string() });

export const deleteFileTool: ToolDefinition<z.infer<typeof DeleteFileInput>, FileMutationResult> = {
  name: "delete_file",
  description: "Delete a file inside the project. Irreversible outside a checkpoint.",
  permission: "dangerous",
  mutating: true,
  inputSchema: DeleteFileInput,
  timeoutMs: 15_000,
  async execute(input, ctx) {
    if (!ctx.allowWrite) throw new ToolError("writes are disabled for this run", "PERMISSION_DENIED");
    const abs = assertWritableInsideRoot(ctx.root, input.path);
    const before = await readText(abs);
    if (before === undefined) throw new ToolError(`file not found: ${input.path}`, "NOT_FOUND");
    if (!ctx.dryRun) await fs.rm(abs, { force: true });
    return {
      path: input.path,
      change: "delete",
      beforeHash: await hashFile(abs),
      diff: unifiedDiff(before, "", { path: input.path }),
      added: 0,
      removed: countLines(before),
      applied: !ctx.dryRun,
    };
  },
};
