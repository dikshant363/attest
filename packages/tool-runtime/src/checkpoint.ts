import fs from "node:fs/promises";
import path from "node:path";
import type { Checkpoint } from "@attest/shared";
import { ensureDir, newId, nowIso, readJson, sha256, writeJsonAtomic } from "@attest/shared";

const IGNORED = new Set([
  "node_modules",
  ".git",
  ".attest",
  "dist",
  ".next",
  "build",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  "vendor",
  ".turbo",
  ".cache",
]);

const MAX_FILE_BYTES = 1_500_000;
const MAX_FILES = 3000;

interface SnapshotEntry {
  path: string;
  hash: string;
  /** Inline content for text files. */
  content?: string;
  /** True for files we deliberately did not capture (binary or too large). */
  skipped?: "binary" | "large";
  size: number;
}

interface SnapshotFile {
  id: string;
  createdAt: string;
  root: string;
  gitHead?: string;
  gitBranch?: string;
  entries: SnapshotEntry[];
  treeHash: string;
  bytes: number;
}

export interface CreateCheckpointOptions {
  taskId: string;
  executionId?: string;
  reason: string;
}

export interface RestoreReport {
  ok: boolean;
  restored: string[];
  deleted: string[];
  skippedUntracked: string[];
  treeHashBefore: string;
  treeHashAfter: string;
  expectedTreeHash: string;
  errors: string[];
}

/**
 * Snapshot-based checkpointing.
 *
 * Why not plain `git stash`/`git reset`? Because those operate on the developer's real
 * git state, and a bad autonomous reset can destroy work that was never committed.
 * A checkpoint here is a private, self-contained copy of the project's text files under
 * `.attest/`, so rollback is a file operation the runtime fully controls and can verify.
 *
 * Cost: disk proportional to project size. Bounded by MAX_FILES/MAX_FILE_BYTES, and
 * ignored directories are never captured or deleted.
 */
export class CheckpointManager {
  constructor(
    private readonly root: string,
    private readonly dirName = ".attest",
  ) {}

  private get dir(): string {
    return path.join(this.root, this.dirName, "checkpoints");
  }

  /**
   * Read the project's text files into memory. Shared by `create` (which persists)
   * and `currentTreeHash` (which must NOT persist, or every hash check would litter
   * the checkpoint store).
   */
  private async scanEntries(): Promise<{ entries: SnapshotEntry[]; bytes: number }> {
    const entries: SnapshotEntry[] = [];
    let bytes = 0;

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 10 || entries.length >= MAX_FILES) return;
      let dirents;
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of dirents) {
        if (entries.length >= MAX_FILES) return;
        if (IGNORED.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(this.root, full).split(path.sep).join("/");
        if (e.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        if (!e.isFile()) continue;
        let stat;
        try {
          stat = await fs.stat(full);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) {
          entries.push({ path: rel, hash: "", size: stat.size, skipped: "large" });
          continue;
        }
        let buf: Buffer;
        try {
          buf = await fs.readFile(full);
        } catch {
          continue;
        }
        if (buf.subarray(0, 8000).includes(0)) {
          entries.push({ path: rel, hash: sha256(buf), size: stat.size, skipped: "binary" });
          continue;
        }
        const content = buf.toString("utf8");
        const hash = sha256(content);
        bytes += content.length;
        entries.push({ path: rel, hash, content, size: stat.size });
      }
    };

    await walk(this.root, 0);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return { entries, bytes };
  }

  async create(opts: CreateCheckpointOptions): Promise<{ checkpoint: Checkpoint; snapshot: SnapshotFile }> {
    const id = newId("cp");
    const { entries, bytes } = await this.scanEntries();
    const treeHash = hashEntries(entries);

    const gitHead = await this.git(["rev-parse", "--short", "HEAD"]);
    const gitBranch = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);

    const snapshot: SnapshotFile = {
      id,
      createdAt: nowIso(),
      root: this.root,
      gitHead,
      gitBranch,
      entries,
      treeHash,
      bytes,
    };

    await ensureDir(this.dir);
    await writeJsonAtomic(path.join(this.dir, `${id}.json`), snapshot);

    const checkpoint: Checkpoint = {
      id,
      taskId: opts.taskId,
      executionId: opts.executionId,
      ref: `snapshot:${id}`,
      kind: "snapshot_dir",
      treeHash,
      createdAt: snapshot.createdAt,
      reason: opts.reason,
    };
    return { checkpoint, snapshot };
  }

  async load(checkpointId: string): Promise<SnapshotFile | undefined> {
    return readJson<SnapshotFile>(path.join(this.dir, `${checkpointId}.json`));
  }

  /** Restore the workspace to a checkpoint, and prove the restoration with a hash. */
  async restore(checkpointId: string): Promise<RestoreReport> {
    const snapshot = await this.load(checkpointId);
    const errors: string[] = [];
    if (!snapshot) {
      return {
        ok: false,
        restored: [],
        deleted: [],
        skippedUntracked: [],
        treeHashBefore: "",
        treeHashAfter: "",
        expectedTreeHash: "",
        errors: [`checkpoint ${checkpointId} not found`],
      };
    }

    const current = await this.scanCurrentPaths();
    const treeHashBefore = await this.currentTreeHash();

    const wanted = new Map(snapshot.entries.map((e) => [e.path, e]));
    const restored: string[] = [];
    const deleted: string[] = [];
    const skippedUntracked: string[] = [];

    // 1. Rewrite every captured file to its checkpointed content.
    for (const entry of snapshot.entries) {
      if (entry.skipped || entry.content === undefined) continue;
      const abs = path.join(this.root, entry.path);
      try {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, entry.content, "utf8");
        restored.push(entry.path);
      } catch (err) {
        errors.push(`restore ${entry.path}: ${(err as Error).message}`);
      }
    }

    // 2. Remove files created since the checkpoint. Only files we would have
    //    snapshotted are eligible, so ignored trees are never touched.
    for (const rel of current) {
      if (wanted.has(rel)) continue;
      if (!isEligibleForRemoval(rel)) {
        skippedUntracked.push(rel);
        continue;
      }
      try {
        await fs.rm(path.join(this.root, rel), { force: true });
        deleted.push(rel);
      } catch (err) {
        errors.push(`delete ${rel}: ${(err as Error).message}`);
      }
    }

    const treeHashAfter = await this.currentTreeHash();
    const ok = errors.length === 0 && treeHashAfter === snapshot.treeHash;
    if (!ok && errors.length === 0) {
      errors.push(
        `post-restore tree hash ${treeHashAfter} does not match checkpoint ${snapshot.treeHash}; ` +
          `the workspace differs from the checkpoint in files the snapshot does not capture.`,
      );
    }

    return {
      ok,
      restored,
      deleted,
      skippedUntracked,
      treeHashBefore,
      treeHashAfter,
      expectedTreeHash: snapshot.treeHash,
      errors,
    };
  }

  /** List the project's current text-file paths, using the same rules as snapshotting. */
  private async scanCurrentPaths(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 10 || out.length >= MAX_FILES) return;
      let dirents;
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of dirents) {
        if (IGNORED.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(this.root, full).split(path.sep).join("/");
        if (e.isDirectory()) await walk(full, depth + 1);
        else if (e.isFile()) out.push(rel);
      }
    };
    await walk(this.root, 0);
    return out;
  }

  /** Hash of the live workspace using the same algorithm as the snapshot tree hash. */
  async currentTreeHash(): Promise<string> {
    const { entries } = await this.scanEntries();
    return hashEntries(entries);
  }

  async list(): Promise<{ id: string; createdAt: string; bytes: number; files: number }[]> {
    try {
      const files = await fs.readdir(this.dir);
      const out: { id: string; createdAt: string; bytes: number; files: number }[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const snap = await readJson<SnapshotFile>(path.join(this.dir, f));
        if (!snap) continue;
        out.push({
          id: snap.id,
          createdAt: snap.createdAt,
          bytes: snap.bytes,
          files: snap.entries.length,
        });
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  private async git(args: string[]): Promise<string | undefined> {
    const { runCommand } = await import("@attest/shared");
    const res = await runCommand(`git ${args.join(" ")}`, { cwd: this.root, timeoutMs: 10_000 });
    return res.exitCode === 0 ? res.stdout.trim() : undefined;
  }
}

function hashEntries(entries: SnapshotEntry[]): string {
  const canonical = entries
    .filter((e) => !e.skipped)
    .map((e) => `${e.path}:${e.hash}`)
    .sort()
    .join("\n");
  return sha256(canonical).slice(0, 32);
}

/** Files we are willing to delete during a rollback: relative, non-ignored paths. */
function isEligibleForRemoval(rel: string): boolean {
  const segments = rel.split("/");
  if (segments.some((s) => IGNORED.has(s))) return false;
  if (rel.startsWith(".attest/")) return false;
  return true;
}
