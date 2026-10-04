import fs from "node:fs/promises";
import path from "node:path";
import type { EvidenceRecord, ProjectWorld, Task, AuditEntry, VerificationResult } from "../../../packages/shared/src/types";

/**
 * Data access for the control centre.
 *
 * The web app reads the Project World directly from disk. There is no API layer and no
 * cache, for two reasons: a second process to keep in sync is a second thing that can be
 * wrong, and "what the agent believes right now" must never be a stale copy.
 *
 * Set ATTEST_PROJECT_DIR to point at any analysed repository.
 */
export const PROJECT_DIR = path.resolve(
  process.env.ATTEST_PROJECT_DIR ?? path.join(process.cwd(), "..", "..", "examples", "auth-fixture"),
);

export interface WorldSnapshot {
  ok: boolean;
  projectDir: string;
  error?: string;
  world?: ProjectWorld;
  audit: AuditEntry[];
  evidenceFiles: string[];
}

export async function loadWorld(): Promise<WorldSnapshot> {
  const base = path.join(PROJECT_DIR, ".attest");
  try {
    const raw = await fs.readFile(path.join(base, "world.json"), "utf8");
    const world = JSON.parse(raw) as ProjectWorld;
    let audit: AuditEntry[] = [];
    try {
      const auditRaw = await fs.readFile(path.join(base, "audit.jsonl"), "utf8");
      audit = auditRaw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as AuditEntry)
        .slice(-60)
        .reverse();
    } catch {
      /* no audit log yet */
    }
    let evidenceFiles: string[] = [];
    try {
      evidenceFiles = (await fs.readdir(path.join(base, "evidence"))).filter((f) => f.endsWith(".json"));
    } catch {
      /* none sealed yet */
    }
    return { ok: true, projectDir: PROJECT_DIR, world, audit, evidenceFiles };
  } catch (err) {
    return {
      ok: false,
      projectDir: PROJECT_DIR,
      error: err instanceof Error ? err.message : String(err),
      audit: [],
      evidenceFiles: [],
    };
  }
}

export function verdictOf(task: Task | undefined): string {
  if (!task) return "—";
  return task.verdict ?? task.status;
}

export function latestEvidence(world: ProjectWorld | undefined): EvidenceRecord | undefined {
  return world?.evidence.at(-1);
}

export function evidenceFor(world: ProjectWorld | undefined, id: string): EvidenceRecord | undefined {
  return world?.evidence.find((e) => e.id === id);
}

export function verificationFor(world: ProjectWorld | undefined, id: string | undefined): VerificationResult | undefined {
  if (!id) return undefined;
  return world?.verifications.find((v) => v.id === id);
}

export const VERDICT_TOKEN: Record<string, string> = {
  VERIFIED: "text-[--color-verify]",
  PARTIALLY_VERIFIED: "text-[--color-caution]",
  UNVERIFIED: "text-[--color-danger]",
  ROLLED_BACK: "text-[--color-rollback]",
  BLOCKED: "text-[--color-danger]",
};

export const VERDICT_GLYPH: Record<string, string> = {
  VERIFIED: "✓",
  PARTIALLY_VERIFIED: "◐",
  UNVERIFIED: "✗",
  ROLLED_BACK: "↩",
  BLOCKED: "⛔",
};
