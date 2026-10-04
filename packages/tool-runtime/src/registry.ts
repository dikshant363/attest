import type { FileChange, PermissionLevel, ToolCall } from "@attest/shared";
import { boundJson, newId, nowIso, sha256 } from "@attest/shared";
import { withToolSpan } from "@attest/observability";
import { ToolError, type ToolContext, type ToolDefinition } from "./types.ts";
import {
  applyEditsTool,
  deleteFileTool,
  editFileTool,
  listFilesTool,
  readFileTool,
  searchTool,
  writeFileTool,
  type FileMutationResult,
} from "./tools/fs.ts";
import { runCommandTool } from "./tools/shell.ts";
import { gitDiffTool, gitStatusTool } from "./tools/git.ts";

export interface InvokeHooks {
  onToolCall?: (call: ToolCall) => void | Promise<void>;
  onFileChanges?: (changes: FileChange[]) => void | Promise<void>;
}

export interface InvokeResult {
  output: unknown;
  call: ToolCall;
  fileChanges: FileChange[];
}

/**
 * The single gate through which every action passes.
 *
 * Responsibilities, in order:
 *   1. resolve the tool and validate input against its declared schema
 *   2. enforce the permission model (read / write / execute / dangerous)
 *   3. enforce a per-tool timeout
 *   4. execute
 *   5. normalise mutations into FileChange records for the evidence trail
 *   6. emit an audit-ready ToolCall, success or failure
 *
 * A tool that is not registered cannot be called. There is no escape hatch.
 */
export class ToolRuntime {
  private tools = new Map<string, ToolDefinition<never, unknown>>();

  constructor(private readonly root: string) {}

  register<I, O>(tool: ToolDefinition<I, O>): this {
    this.tools.set(tool.name, tool as unknown as ToolDefinition<never, unknown>);
    return this;
  }

  registerAll(tools: ToolDefinition<never, unknown>[]): this {
    for (const t of tools) this.register(t);
    return this;
  }

  list(): { name: string; description: string; permission: PermissionLevel; mutating: boolean }[] {
    return [...this.tools.values()]
      .map((t) => ({
        name: t.name,
        description: t.description,
        permission: t.permission,
        mutating: t.mutating,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** The default tool set. Only these exist for an autonomous run. */
  static withDefaults(root: string): ToolRuntime {
    return new ToolRuntime(root).registerAll([
      readFileTool,
      listFilesTool,
      searchTool,
      writeFileTool,
      editFileTool,
      applyEditsTool,
      deleteFileTool,
      runCommandTool,
      gitStatusTool,
      gitDiffTool,
    ] as unknown as ToolDefinition<never, unknown>[]);
  }

  private checkPermission(tool: ToolDefinition<never, unknown>, ctx: ToolContext): void {
    const p = tool.permission;
    if (p === "read") return;
    if (p === "execute") {
      if (ctx.allowExecute === false) {
        throw new ToolError(`tool "${tool.name}" needs execute permission, which is disabled`, "PERMISSION_DENIED");
      }
      return;
    }
    if (p === "write") {
      if (!ctx.allowWrite) {
        throw new ToolError(`tool "${tool.name}" needs write permission, which is disabled`, "PERMISSION_DENIED");
      }
      return;
    }
    // dangerous
    if (!ctx.allowDangerous) {
      throw new ToolError(
        `tool "${tool.name}" is destructive and requires explicit human approval for this run`,
        "PERMISSION_DENIED",
      );
    }
    if (!ctx.allowWrite) {
      throw new ToolError(`tool "${tool.name}" needs write permission, which is disabled`, "PERMISSION_DENIED");
    }
  }

  async invoke(name: string, input: unknown, ctx: ToolContext, hooks: InvokeHooks = {}): Promise<InvokeResult> {
    const started = Date.now();
    const tool = this.tools.get(name);
    const base = (ok: boolean, error?: string, output?: unknown): ToolCall => ({
      id: newId("call"),
      executionId: ctx.executionId ?? "none",
      tool: name,
      permission: tool?.permission ?? "read",
      input: boundJson(input),
      output: boundJson(output),
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      ok,
      error,
      mutating: tool?.mutating ?? false,
    });

    if (!tool) {
      const call = base(false, `unknown tool "${name}"`);
      await hooks.onToolCall?.(call);
      throw new ToolError(`unknown tool "${name}"`, "INVALID_INPUT");
    }

    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success || parsed.data === undefined) {
      const message = `invalid input for tool "${name}": ${formatZodError(parsed.error)}`;
      const call = base(false, message);
      await hooks.onToolCall?.(call);
      throw new ToolError(message, "INVALID_INPUT", parsed.error);
    }

    try {
      this.checkPermission(tool, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const call = base(false, message);
      await hooks.onToolCall?.(call);
      throw err;
    }

    if (tool.precondition) {
      const problem = await tool.precondition(parsed.data as never, ctx);
      if (problem) {
        const call = base(false, problem);
        await hooks.onToolCall?.(call);
        throw new ToolError(problem, "INVALID_INPUT");
      }
    }

    const timeoutMs = Math.min(tool.timeoutMs, ctx.timeoutMs ?? tool.timeoutMs);
    let timer: NodeJS.Timeout | undefined;
    try {
      const output = await withToolSpan(
        { tool: name, permission: tool.permission, mutating: tool.mutating },
        async (addAttributes) => {
          const result = await Promise.race([
            tool.execute(parsed.data as never, ctx),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new ToolError(`tool "${name}" timed out after ${timeoutMs}ms`, "TIMEOUT")),
                timeoutMs,
              );
            }),
          ]);
          addAttributes({ "attest.tool.ok": true });
          return result;
        },
      );

      const fileChanges = toFileChanges(output);
      const call = base(true, undefined, output);
      await hooks.onToolCall?.(call);
      if (fileChanges.length) await hooks.onFileChanges?.(fileChanges);
      return { output, call, fileChanges };
    } catch (err) {
      const isToolError = err instanceof ToolError;
      const message = err instanceof Error ? err.message : String(err);
      const call = base(false, message);
      await hooks.onToolCall?.(call);
      if (isToolError) throw err;
      throw new ToolError(message, "EXECUTION_FAILED", err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Stable digest of the tool surface, so evidence can cite exactly which tools existed. */
  surfaceDigest(): string {
    return sha256(
      this.list()
        .map((t) => `${t.name}:${t.permission}:${t.mutating}`)
        .join("\n"),
    ).slice(0, 16);
  }
}

function toFileChanges(output: unknown): FileChange[] {
  if (!output || typeof output !== "object") return [];
  const obj = output as Record<string, unknown>;

  // apply_edits → { results: FileMutationResult[] }
  if (Array.isArray(obj.results)) {
    return (obj.results as FileMutationResult[]).filter(isMutation).map(toFileChange);
  }
  if (isMutation(obj)) return [toFileChange(obj)];
  return [];
}

function isMutation(v: unknown): v is FileMutationResult {
  return Boolean(v && typeof v === "object" && "path" in v && "change" in v && "applied" in v);
}

function toFileChange(m: FileMutationResult): FileChange {
  return {
    path: m.path,
    change: m.change,
    added: m.added,
    removed: m.removed,
    diff: m.diff,
    beforeHash: m.beforeHash,
    afterHash: m.afterHash,
  };
}

function formatZodError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  }
  return String(error);
}

export { nowIso };
