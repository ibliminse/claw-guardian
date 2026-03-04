/**
 * patches.ts — Idempotent patch runner
 * Runs shell commands with idempotency checks.
 * Never throws — all errors caught and logged.
 */

import { execSync } from "node:child_process";

export interface PatchConfig {
  name: string;
  cmd: string;
  idempotent_check?: string;
}

export interface PatchResult {
  name: string;
  status: "APPLIED" | "SKIPPED" | "FAILED";
  reason?: string;
  durationMs: number;
}

export function runPatches(patches: PatchConfig[]): PatchResult[] {
  const results: PatchResult[] = [];

  for (const patch of patches) {
    const start = Date.now();

    try {
      // If idempotent_check is set, run it first
      if (patch.idempotent_check) {
        try {
          execSync(patch.idempotent_check, {
            timeout: 10_000,
            stdio: "pipe",
            shell: "/bin/bash",
          });
          // Exit 0 = already applied, skip
          results.push({
            name: patch.name,
            status: "SKIPPED",
            reason: "idempotent_check passed (already applied)",
            durationMs: Date.now() - start,
          });
          continue;
        } catch {
          // Exit non-0 = not applied yet, proceed
        }
      }

      // Run the patch command
      execSync(patch.cmd, {
        timeout: 30_000,
        stdio: "pipe",
        shell: "/bin/bash",
      });

      results.push({
        name: patch.name,
        status: "APPLIED",
        durationMs: Date.now() - start,
      });
    } catch (err: any) {
      results.push({
        name: patch.name,
        status: "FAILED",
        reason: err.stderr?.toString()?.trim() || err.message || "Unknown error",
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}
