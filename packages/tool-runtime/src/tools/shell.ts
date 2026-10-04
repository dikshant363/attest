import { z } from "zod";
import { runCommand, truncate } from "@attest/shared";
import { ToolError, type ToolContext, type ToolDefinition } from "../types.ts";

/**
 * Command policy.
 *
 * The runtime executes verification commands that the project declares, and commands a
 * plan step names explicitly. A model must never be able to turn a "fix the tests" task
 * into `rm -rf ~`. These patterns are refused before a process is spawned, and the
 * refusal is audited.
 */
export const DENIED_COMMAND_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+\/(?!\w)/, reason: "recursive delete of filesystem root" },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(~|\$HOME)(\/|\s|$)/, reason: "recursive delete of home directory" },
  { pattern: /\b(curl|wget)\b[^|;]*\|\s*(sudo\s+)?(ba)?sh\b/, reason: "piping a remote script into a shell" },
  { pattern: /\bsudo\b/, reason: "privilege escalation" },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\//, reason: "world-writable filesystem root" },
  { pattern: /\bmkfs(\.\w+)?\b/, reason: "filesystem format" },
  { pattern: /\bdd\b[^|;]*\bof=\/dev\//, reason: "raw device write" },
  { pattern: /:\(\)\s*\{.*\}\s*;\s*:/, reason: "fork bomb" },
  { pattern: /\b(shutdown|reboot|halt)\b/, reason: "host power control" },
  { pattern: /\bgit\s+push\b/, reason: "publishing commits is an irreversible external action" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "destroys uncommitted work" },
  { pattern: /\bnpm\s+publish\b|\bpnpm\s+publish\b|\byarn\s+publish\b/, reason: "publishing a package is irreversible" },
  { pattern: /\b(kill|pkill|killall)\s+(-9\s+)?-?1\b/, reason: "killing all processes" },
  { pattern: />\s*\/dev\/(sd|disk|nvme)/, reason: "raw device write" },
  { pattern: /\bhistory\s+-c\b/, reason: "anti-forensics" },
];

export function inspectCommand(command: string): { allowed: boolean; reason?: string } {
  const normalized = command.replace(/\s+/g, " ").trim();
  for (const { pattern, reason } of DENIED_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) return { allowed: false, reason };
  }
  return { allowed: true };
}

const RunCommandInput = z.object({
  command: z.string().min(1).describe("Shell command to run inside the project root"),
  timeoutMs: z.number().int().min(1000).max(900_000).optional(),
  /** Set true to run even if the command matches the deny list. Requires human approval upstream. */
  acknowledgeRisk: z.boolean().optional(),
});

export const runCommandTool: ToolDefinition<
  z.infer<typeof RunCommandInput>,
  { command: string; exitCode: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean }
> = {
  name: "run_command",
  description:
    "Run a shell command inside the project root and capture stdout, stderr and exit code. Refuses known-destructive commands.",
  permission: "execute",
  mutating: false,
  inputSchema: RunCommandInput,
  timeoutMs: 900_000,
  async execute(input, ctx: ToolContext) {
    const verdict = inspectCommand(input.command);
    if (!verdict.allowed && !input.acknowledgeRisk) {
      throw new ToolError(
        `command refused by policy: ${verdict.reason}. If this is intentional, a human must approve it.`,
        "PERMISSION_DENIED",
        { command: input.command, reason: verdict.reason },
      );
    }
    const result = await runCommand(input.command, {
      cwd: ctx.root,
      timeoutMs: input.timeoutMs ?? ctx.timeoutMs ?? 300_000,
    });
    return {
      command: result.command,
      exitCode: result.exitCode,
      stdout: truncate(result.stdout, 20_000),
      stderr: truncate(result.stderr, 20_000),
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    };
  },
};
