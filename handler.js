/**
 * claw-guardian — handler.js (v0.1.0)
 * 
 * Self-contained handler using ONLY Node.js built-ins.
 * No openclaw internal imports — survives any update.
 * 
 * Runs on gateway:startup to:
 * 1. Load GUARDIAN.md config from workspace
 * 2. Apply idempotent patches (with daily tracking)
 * 3. Run smoke tests
 * 4. Alert via Telegram on failures (rate-limited, crash-loop aware)
 * 
 * SAFETY: This handler NEVER throws. Every path is wrapped in try/catch.
 * A crashed hook can destabilize gateway startup — we fail silently instead.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { request } from "node:https";

// ─── Constants ──────────────────────────────────────────────

const LOG_PREFIX = "[claw-guardian]";
const RATE_LIMIT_FILE = "/tmp/.guardian-notified";
const RATE_LIMIT_MS = 60_000;
const CRASH_LOOP_FILE = "/tmp/.guardian-crash-loop";
const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CRASH_LOOP_THRESHOLD = 3;

// ─── Logging Helpers ────────────────────────────────────────

function log(msg) {
  try { console.log(`${LOG_PREFIX} ${msg}`); } catch { /* swallow */ }
}

function logError(msg) {
  try { process.stderr.write(`${LOG_PREFIX} ${msg}\n`); } catch { /* swallow */ }
}

// ─── Patch Tracking (Daily Idempotency) ─────────────────────

function getPatchTrackingPath() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `/tmp/.guardian-patches-${today}.json`;
}

function loadPatchTracking() {
  try {
    const path = getPatchTrackingPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch { /* corrupt file, start fresh */ }
  return {};
}

function savePatchTracking(tracking) {
  try {
    writeFileSync(getPatchTrackingPath(), JSON.stringify(tracking, null, 2));
  } catch { /* ignore */ }
}

function isPatchTrackedToday(patchName) {
  const tracking = loadPatchTracking();
  return tracking[patchName] === true;
}

function markPatchApplied(patchName) {
  const tracking = loadPatchTracking();
  tracking[patchName] = true;
  savePatchTracking(tracking);
}

// ─── Crash Loop Detection ───────────────────────────────────

function recordStartup() {
  try {
    let entries = [];
    if (existsSync(CRASH_LOOP_FILE)) {
      try {
        entries = JSON.parse(readFileSync(CRASH_LOOP_FILE, "utf-8"));
        if (!Array.isArray(entries)) entries = [];
      } catch { entries = []; }
    }

    const now = Date.now();
    // Keep only entries within the window
    entries = entries.filter((ts) => now - ts < CRASH_LOOP_WINDOW_MS);
    entries.push(now);
    writeFileSync(CRASH_LOOP_FILE, JSON.stringify(entries));
    return entries.length;
  } catch {
    return 1;
  }
}

function isInCrashLoop() {
  try {
    if (!existsSync(CRASH_LOOP_FILE)) return false;
    const entries = JSON.parse(readFileSync(CRASH_LOOP_FILE, "utf-8"));
    if (!Array.isArray(entries)) return false;
    const now = Date.now();
    const recent = entries.filter((ts) => now - ts < CRASH_LOOP_WINDOW_MS);
    return recent.length >= CRASH_LOOP_THRESHOLD;
  } catch {
    return false;
  }
}

// ─── Config Parser ──────────────────────────────────────────

function parseKeyValue(str, target) {
  try {
    const colonIdx = str.indexOf(":");
    if (colonIdx === -1) return;

    const key = str.slice(0, colonIdx).trim();
    let value = str.slice(colonIdx + 1).trim();

    // Remove quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Remove inline comments (only outside quotes)
    const commentIdx = value.indexOf(" #");
    if (commentIdx !== -1) {
      value = value.slice(0, commentIdx).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
    }

    // Convert numeric values for known keys
    if (key === "timeout" && !isNaN(Number(value))) {
      target[key] = Number(value);
    } else {
      target[key] = value;
    }
  } catch { /* malformed line, skip */ }
}

function loadConfig(workspaceDir) {
  try {
    if (!workspaceDir || typeof workspaceDir !== "string") {
      log("Invalid workspace dir, falling back to default");
      workspaceDir = "/home/ubuntu/.openclaw/workspace";
    }

    if (!existsSync(workspaceDir)) {
      log(`Workspace dir does not exist: ${workspaceDir}`);
      return null;
    }

    const configPath = join(workspaceDir, "GUARDIAN.md");

    if (!existsSync(configPath)) {
      return null;
    }

    const content = readFileSync(configPath, "utf-8");

    // Extract frontmatter between --- markers
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      log("GUARDIAN.md has no valid frontmatter (missing --- markers)");
      return null;
    }

    const yaml = match[1];

    const config = {
      notify: { channel: "telegram", target: "", on: "failures" },
      patches: [],
      tests: [],
    };

    let currentSection = "root";
    let currentItem = null;

    for (const rawLine of yaml.split("\n")) {
      const line = rawLine.replace(/\r$/, "");

      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith("#")) continue;

      const trimmed = line.trim();

      // Top-level: guardian:
      if (trimmed === "guardian:") continue;

      // Section headers
      if (trimmed === "notify:") {
        currentSection = "notify";
        currentItem = null;
        continue;
      }
      if (trimmed === "patches:" || trimmed === "patches: []") {
        currentSection = "patches";
        currentItem = null;
        continue;
      }
      if (trimmed === "tests:" || trimmed === "tests: []") {
        currentSection = "tests";
        currentItem = null;
        continue;
      }

      // Array item start (- name: "...")
      if (trimmed.startsWith("- ")) {
        const itemContent = trimmed.slice(2).trim();
        if (currentSection === "patches") {
          currentItem = {};
          config.patches.push(currentItem);
          parseKeyValue(itemContent, currentItem);
          continue;
        }
        if (currentSection === "tests") {
          currentItem = {};
          config.tests.push(currentItem);
          parseKeyValue(itemContent, currentItem);
          continue;
        }
      }

      // Key: value pairs
      if (trimmed.includes(":")) {
        if (currentSection === "notify") {
          parseKeyValue(trimmed, config.notify);
        } else if (
          currentItem &&
          (currentSection === "patches" || currentSection === "tests")
        ) {
          parseKeyValue(trimmed, currentItem);
        }
      }
    }

    return config;
  } catch (err) {
    logError(`Failed to parse GUARDIAN.md: ${err?.message ?? err}`);
    return null;
  }
}

// ─── Patch Runner ───────────────────────────────────────────

function runPatches(patches) {
  const results = [];

  if (!Array.isArray(patches)) return results;

  for (const patch of patches) {
    const start = Date.now();

    try {
      if (!patch || !patch.cmd) {
        results.push({
          name: patch?.name || "unnamed",
          status: "FAILED",
          reason: "Missing cmd field",
          durationMs: Date.now() - start,
        });
        continue;
      }

      // Check daily tracking first (even if no idempotent_check)
      if (isPatchTrackedToday(patch.name || patch.cmd)) {
        results.push({
          name: patch.name || "unnamed",
          status: "SKIPPED",
          reason: "Already applied today (tracked)",
          durationMs: Date.now() - start,
        });
        continue;
      }

      // If idempotent_check is set, run it
      if (patch.idempotent_check) {
        try {
          execSync(patch.idempotent_check, {
            timeout: 10_000,
            stdio: "pipe",
            shell: "/bin/bash",
          });
          // Exit 0 = already applied, skip and track
          markPatchApplied(patch.name || patch.cmd);
          results.push({
            name: patch.name || "unnamed",
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

      // Track successful application
      markPatchApplied(patch.name || patch.cmd);

      results.push({
        name: patch.name || "unnamed",
        status: "APPLIED",
        durationMs: Date.now() - start,
      });
    } catch (err) {
      results.push({
        name: patch?.name || "unnamed",
        status: "FAILED",
        reason:
          err?.stderr?.toString()?.trim() || err?.message || "Unknown error",
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}

// ─── Smoke Test Runner ──────────────────────────────────────

function runTests(tests) {
  const results = [];

  if (!Array.isArray(tests)) return results;

  for (const test of tests) {
    const start = Date.now();

    try {
      if (!test || !test.cmd) {
        results.push({
          name: test?.name || "unnamed",
          passed: false,
          reason: "Missing cmd field",
          durationMs: Date.now() - start,
        });
        continue;
      }

      const timeoutMs = (test.timeout || 10) * 1000;

      execSync(test.cmd, {
        timeout: timeoutMs,
        stdio: "pipe",
        shell: "/bin/bash",
        env: {
          ...process.env,
          PATH: `/home/ubuntu/.npm-global/bin:${process.env.PATH}`,
        },
      });

      results.push({
        name: test.name || "unnamed",
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      let reason = "Unknown error";

      try {
        if (err?.killed) {
          reason = `Timed out after ${test?.timeout || 10}s`;
        } else if (err?.stderr && err.stderr.toString().trim()) {
          reason = err.stderr.toString().trim().slice(0, 200);
        } else if (err?.message) {
          reason = err.message.slice(0, 200);
        }
      } catch { /* leave as "Unknown error" */ }

      results.push({
        name: test?.name || "unnamed",
        passed: false,
        reason,
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}

// ─── Telegram Notifier ──────────────────────────────────────

function getBotToken() {
  try {
    // 1. Check env directly
    if (process.env.TELEGRAM_BOT_TOKEN) {
      return process.env.TELEGRAM_BOT_TOKEN;
    }

    // 2. Try global.env
    const envPath = join(
      process.env.HOME || "/home/ubuntu",
      ".config/env/global.env"
    );
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(
          /^(?:export\s+)?TELEGRAM_BOT_TOKEN=["']?([^"'\s]+)["']?/
        );
        if (match) return match[1];
      }
    }
  } catch { /* ignore */ }

  return null;
}

function isRateLimited() {
  try {
    if (existsSync(RATE_LIMIT_FILE)) {
      const ts = parseInt(readFileSync(RATE_LIMIT_FILE, "utf-8").trim(), 10);
      if (Date.now() - ts < RATE_LIMIT_MS) {
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

function writeRateLimit() {
  try {
    writeFileSync(RATE_LIMIT_FILE, String(Date.now()));
  } catch { /* ignore */ }
}

function formatMessage(payload, startupCount) {
  try {
    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, " UTC");

    const applied = payload.patchResults.filter(
      (p) => p.status === "APPLIED"
    ).length;
    const skipped = payload.patchResults.filter(
      (p) => p.status === "SKIPPED"
    ).length;
    const patchFailed = payload.patchResults.filter(
      (p) => p.status === "FAILED"
    );

    const passed = payload.testResults.filter((t) => t.passed).length;
    const testFailed = payload.testResults.filter((t) => !t.passed);

    const lines = [];

    // Crash loop warning
    if (startupCount >= CRASH_LOOP_THRESHOLD) {
      lines.push(`⚠️ claw-guardian — CRASH LOOP DETECTED`);
      lines.push(`Gateway restarted ${startupCount}x in ${CRASH_LOOP_WINDOW_MS / 60000} minutes`);
    } else {
      lines.push("🛡️ claw-guardian alert");
    }

    lines.push(`📅 ${now}`);
    lines.push("");

    if (payload.patchResults.length > 0) {
      lines.push(
        `Patches: ${applied} applied, ${skipped} skipped, ${patchFailed.length} failed`
      );
    }

    lines.push(`Tests: ${passed} passed, ${testFailed.length} failed`);

    if (testFailed.length > 0) {
      lines.push("");
      lines.push("❌ Failed tests:");
      for (const t of testFailed) {
        lines.push(`• ${t.name}: ${t.reason || "unknown"}`);
      }
    }

    if (patchFailed.length > 0) {
      lines.push("");
      lines.push("❌ Failed patches:");
      for (const p of patchFailed) {
        lines.push(`• ${p.name}: ${p.reason || "unknown"}`);
      }
    }

    return lines.join("\n");
  } catch {
    return "🛡️ claw-guardian: alert formatting error — check logs";
  }
}

function formatSuccessMessage(payload) {
  try {
    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, " UTC");

    const applied = payload.patchResults.filter((p) => p.status === "APPLIED").length;
    const skipped = payload.patchResults.filter((p) => p.status === "SKIPPED").length;
    const passed = payload.testResults.filter((t) => t.passed).length;

    const parts = [];
    if (payload.patchResults.length > 0) {
      parts.push(`${applied} patched, ${skipped} skipped`);
    }
    parts.push(`${passed}/${payload.testResults.length} tests passed`);

    return `✅ claw-guardian — all clear (${parts.join(", ")}) — ${now}`;
  } catch {
    return "✅ claw-guardian — all clear";
  }
}

function sendTelegram(token, chatId, text, threadId) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify({
        chat_id: chatId,
        text,
        ...(threadId ? { message_thread_id: Number(threadId) } : {}),
      });

      const req = request(
        {
          hostname: "api.telegram.org",
          path: `/bot${token}/sendMessage`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 10_000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            resolve(res.statusCode === 200);
          });
        }
      );

      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.write(body);
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function notifyTelegram(config, payload, startupCount) {
  try {
    // Check if notifications are disabled
    if (!config || config.on === "never") return;

    // Check if we should notify
    const hasFailures =
      (payload.testResults || []).some((t) => !t.passed) ||
      (payload.patchResults || []).some((p) => p.status === "FAILED");

    // Silent pass mode: only notify on failures (unless "always")
    if (config.on === "failures" && !hasFailures) return;

    // In "always" mode with no failures, send a brief success message
    if (config.on === "always" && !hasFailures) {
      // Still rate-limit success messages
      if (isRateLimited()) {
        log("Success notification rate limited, skipping");
        return;
      }

      const token = getBotToken();
      if (!token) {
        logError("No TELEGRAM_BOT_TOKEN found");
        return;
      }

      const message = formatSuccessMessage(payload);
      const sent = await sendTelegram(token, config.target, message, config.threadId);
      if (sent) writeRateLimit();
      return;
    }

    // Crash loop handling: suppress individual alerts, send one summary
    if (startupCount > CRASH_LOOP_THRESHOLD) {
      // Already sent the crash loop alert on the 3rd restart — suppress further
      log(`Crash loop: suppressing alert (startup #${startupCount})`);
      return;
    }

    // Rate limit check
    if (isRateLimited()) {
      log("Notification rate limited, skipping");
      return;
    }

    // Get bot token
    const token = getBotToken();
    if (!token) {
      logError("No TELEGRAM_BOT_TOKEN found");
      return;
    }

    // Format and send
    const message = formatMessage(payload, startupCount);
    const sent = await sendTelegram(token, config.target, message, config.threadId);

    if (sent) {
      writeRateLimit();
      log("Notification sent");
    } else {
      logError("Failed to send notification");
    }
  } catch (err) {
    logError(`Notification error: ${err?.message ?? err}`);
  }
}

// ─── Main Guardian Logic ────────────────────────────────────

async function runGuardian(event) {
  // Manual type check — no openclaw internal imports
  if (event?.type !== "gateway" || event?.action !== "startup") return;

  log("Gateway startup detected — running guardian checks...");

  // Record this startup for crash loop detection
  const startupCount = recordStartup();
  if (startupCount > 1) {
    log(`Startup #${startupCount} in the last ${CRASH_LOOP_WINDOW_MS / 60000} minutes`);
  }

  // 1. Find workspace dir from event context
  const workspaceDir =
    event?.context?.cfg?.workspace?.dir ||
    process.env.OPENCLAW_WORKSPACE_DIR ||
    "/home/ubuntu/.openclaw/workspace";

  // 2. Load config
  const config = loadConfig(workspaceDir);
  if (!config) {
    log("No GUARDIAN.md found (or invalid) — no-op");
    return;
  }

  // 3. Run patches
  const patchResults = runPatches(config.patches || []);
  for (const r of patchResults) {
    log(
      `Patch "${r.name}": ${r.status}${r.reason ? ` (${r.reason})` : ""}`
    );
  }

  // 4. Run smoke tests
  const testResults = runTests(config.tests || []);
  for (const r of testResults) {
    log(
      `Test "${r.name}": ${r.passed ? "PASS" : "FAIL"}${r.reason ? ` (${r.reason})` : ""} [${r.durationMs}ms]`
    );
  }

  // 5. Notify (with crash loop awareness)
  await notifyTelegram(config.notify, { patchResults, testResults }, startupCount);
}

// ─── Exported Handler (Top-Level Safety Wrapper) ────────────

const handler = async (event) => {
  try {
    await runGuardian(event);
  } catch (err) {
    // Last resort — log to stderr but NEVER throw
    // A thrown error here could destabilize gateway startup
    try {
      process.stderr.write(
        `${LOG_PREFIX} FATAL: ${err?.message ?? err}\n`
      );
    } catch {
      // Even stderr write failed — truly nothing we can do
    }
  }
};

export default handler;
