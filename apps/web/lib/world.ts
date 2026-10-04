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
 * Resolution order, so the same code serves both a developer's machine and a deployment:
 *   1. ATTEST_WORLD_FILE        — an explicit path to a world.json
 *   2. ATTEST_PROJECT_DIR       — an analysed repository (reads <dir>/.attest/world.json)
 *   3. <app>/data/world.json    — a committed snapshot, used for the hosted demo
 */

function resolveWorldFile(): string {
  if (process.env.ATTEST_WORLD_FILE) {
    return path.resolve(process.env.ATTEST_WORLD_FILE);
  }
  if (process.env.ATTEST_PROJECT_DIR) {
    return path.join(path.resolve(process.env.ATTEST_PROJECT_DIR), ".attest", "world.json");
  }
  // Default: the analysed example repo when running from the monorepo, else the snapshot.
  const monorepoFixture = path.join(process.cwd(), "..", "..", "examples", "auth-fixture", ".attest", "world.json");
  return monorepoFixture;
}

export const WORLD_FILE = resolveWorldFile();

/** Where the audit log lives, if present. */
function resolveAuditFile(): string | undefined {
  if (process.env.ATTEST_AUDIT_FILE) return path.resolve(process.env.ATTEST_AUDIT_FILE);
  if (process.env.ATTEST_PROJECT_DIR) {
    return path.join(path.resolve(process.env.ATTEST_PROJECT_DIR), ".attest", "audit.jsonl");
  }
  return path.join(path.dirname(WORLD_FILE), "audit.jsonl");
}

/** A root used only for rendering the tool surface; the tools page never touches the disk. */
export const PROJECT_DIR = process.env.ATTEST_PROJECT_DIR
  ? path.resolve(process.env.ATTEST_PROJECT_DIR)
  : path.dirname(path.dirname(WORLD_FILE));

export interface WorldSnapshot {
  ok: boolean;
  worldFile: string;
  error?: string;
  world?: ProjectWorld;
  audit: AuditEntry[];
  evidenceFiles: string[];
}

export async function loadWorld(): Promise<WorldSnapshot> {
  // A hosted demo ships a committed snapshot; prefer it when the live world is absent.
  const candidates = [WORLD_FILE];
  candidates.push(path.join(process.cwd(), "data", "world.json"));

  let lastError: string | undefined;
  for (const worldFile of candidates) {
    try {
      const raw = await fs.readFile(worldFile, "utf8");
      const world = JSON.parse(raw) as ProjectWorld;

      // The audit log may be shipped alongside the snapshot for the hosted demo.
      let audit: AuditEntry[] = [];
      const auditFile = path.join(path.dirname(worldFile), "audit.jsonl");
      for (const candidate of [resolveAuditFile(), auditFile].filter(Boolean) as string[]) {
        try {
          const auditRaw = await fs.readFile(candidate, "utf8");
          audit = auditRaw
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l) as AuditEntry)
            .slice(-80)
            .reverse();
          if (audit.length) break;
        } catch {
          /* try the next location */
        }
      }

      let evidenceFiles: string[] = [];
      try {
        evidenceFiles = (await fs.readdir(path.join(path.dirname(worldFile), "evidence"))).filter((f) =>
          f.endsWith(".json"),
        );
      } catch {
        /* none sealed alongside the world */
      }

      return { ok: true, worldFile, world, audit, evidenceFiles };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, worldFile: candidates[0]!, error: lastError, audit: [], evidenceFiles: [] };
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

export function verificationFor(
  world: ProjectWorld | undefined,
  id: string | undefined,
): VerificationResult | undefined {
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
