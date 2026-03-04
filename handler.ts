/**
 * handler.ts — claw-guardian main handler (TypeScript reference)
 * 
 * This is the TypeScript reference implementation.
 * The actual handler.js is a self-contained vanilla JS version
 * that uses ONLY Node.js built-ins (no openclaw internal imports).
 * 
 * This ensures 100% stability across openclaw updates —
 * no dependency on internal filenames that change with each build.
 * 
 * SAFETY: The exported handler NEVER throws. A top-level safety
 * wrapper catches everything and logs to stderr.
 */

import { loadConfig } from "./src/config.js";
import { runPatches } from "./src/patches.js";
import { runTests } from "./src/tests.js";
import { notify } from "./src/notify.js";

async function runGuardian(event: any): Promise<void> {
  // Manual type check — no openclaw internal imports needed
  if (event?.type !== "gateway" || event?.action !== "startup") return;

  console.log("[claw-guardian] Gateway startup detected — running guardian checks...");

  // 1. Find workspace dir from event context
  const workspaceDir =
    event?.context?.cfg?.workspace?.dir ||
    process.env.OPENCLAW_WORKSPACE_DIR ||
    "/home/ubuntu/.openclaw/workspace";

  // 2. Load config
  const config = loadConfig(workspaceDir);
  if (!config) {
    console.log("[claw-guardian] No GUARDIAN.md found — no-op");
    return;
  }

  // 3. Run patches
  const patchResults = runPatches(config.patches);
  for (const r of patchResults) {
    console.log(`[claw-guardian] Patch "${r.name}": ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  }

  // 4. Run smoke tests
  const testResults = runTests(config.tests);
  for (const r of testResults) {
    console.log(`[claw-guardian] Test "${r.name}": ${r.passed ? "PASS" : "FAIL"}${r.reason ? ` (${r.reason})` : ""} [${r.durationMs}ms]`);
  }

  // 5. Notify
  await notify(config.notify, { patchResults, testResults });
}

// Top-level safety wrapper — NEVER throws
const handler = async (event: any): Promise<void> => {
  try {
    await runGuardian(event);
  } catch (err: any) {
    // Last resort — log to stderr but NEVER throw
    try {
      process.stderr.write(`[claw-guardian] FATAL: ${err?.message ?? err}\n`);
    } catch {
      // Even stderr write failed — truly nothing we can do
    }
  }
};

export default handler;
