/**
 * notify.ts — Telegram notifier
 * Sends alerts via Telegram Bot API.
 * Rate limited: skips if last notification < 60s ago.
 * Never throws.
 */

import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";

const RATE_LIMIT_FILE = "/tmp/.guardian-notified";
const RATE_LIMIT_MS = 60_000; // 60 seconds

export interface NotifyConfig {
  channel: string;
  target: string;
  threadId?: string;
  on: "always" | "failures" | "never";
}

export interface NotifyPayload {
  patchResults: { name: string; status: string; reason?: string }[];
  testResults: { name: string; passed: boolean; reason?: string }[];
}

function getBotToken(): string | null {
  // 1. Check env directly
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  // 2. Try global.env
  const envPath = path.join(
    process.env.HOME || "/home/ubuntu",
    ".config/env/global.env"
  );
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(
          /^(?:export\s+)?TELEGRAM_BOT_TOKEN=["']?([^"'\s]+)["']?/
        );
        if (match) return match[1];
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function isRateLimited(): boolean {
  try {
    if (fs.existsSync(RATE_LIMIT_FILE)) {
      const ts = parseInt(fs.readFileSync(RATE_LIMIT_FILE, "utf-8").trim(), 10);
      if (Date.now() - ts < RATE_LIMIT_MS) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function writeRateLimit(): void {
  try {
    fs.writeFileSync(RATE_LIMIT_FILE, String(Date.now()));
  } catch {
    // ignore
  }
}

function formatMessage(payload: NotifyPayload): string {
  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

  const applied = payload.patchResults.filter((p) => p.status === "APPLIED").length;
  const skipped = payload.patchResults.filter((p) => p.status === "SKIPPED").length;
  const patchFailed = payload.patchResults.filter((p) => p.status === "FAILED");

  const passed = payload.testResults.filter((t) => t.passed).length;
  const testFailed = payload.testResults.filter((t) => !t.passed);

  const lines: string[] = [
    "🛡️ claw-guardian alert",
    `📅 ${now}`,
    "",
  ];

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
}

function sendTelegram(
  token: string,
  chatId: string,
  text: string,
  threadId?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      ...(threadId ? { message_thread_id: Number(threadId) } : {}),
    });

    const req = https.request(
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
        res.on("data", (chunk: Buffer) => (data += chunk));
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
  });
}

export async function notify(
  config: NotifyConfig,
  payload: NotifyPayload
): Promise<void> {
  try {
    // Check if notifications are disabled
    if (config.on === "never") return;

    // Check if we should notify
    const hasFailures =
      payload.testResults.some((t) => !t.passed) ||
      payload.patchResults.some((p) => p.status === "FAILED");

    if (config.on === "failures" && !hasFailures) return;

    // Rate limit check
    if (isRateLimited()) {
      console.log("[claw-guardian] Notification rate limited, skipping");
      return;
    }

    // Get bot token
    const token = getBotToken();
    if (!token) {
      console.error("[claw-guardian] No TELEGRAM_BOT_TOKEN found");
      return;
    }

    // Format and send
    const message = formatMessage(payload);
    const sent = await sendTelegram(token, config.target, message, config.threadId);

    if (sent) {
      writeRateLimit();
      console.log("[claw-guardian] Notification sent");
    } else {
      console.error("[claw-guardian] Failed to send notification");
    }
  } catch (err) {
    console.error("[claw-guardian] Notification error:", err);
  }
}
