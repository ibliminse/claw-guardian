/**
 * config.ts — GUARDIAN.md frontmatter parser
 * Uses regex-based YAML parsing (no npm deps)
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface GuardianPatch {
  name: string;
  cmd: string;
  idempotent_check?: string;
}

export interface GuardianTest {
  name: string;
  cmd: string;
  timeout?: number; // seconds, default 10
}

export interface GuardianNotify {
  channel: string;
  target: string;
  threadId?: string;
  on: "always" | "failures" | "never";
}

export interface GuardianConfig {
  notify: GuardianNotify;
  patches: GuardianPatch[];
  tests: GuardianTest[];
}

/**
 * Minimal YAML-ish frontmatter parser.
 * Handles the subset of YAML used in GUARDIAN.md config.
 * No external deps — regex + state machine.
 */
function parseFrontmatter(content: string): GuardianConfig | null {
  // Extract frontmatter between --- markers
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  
  // Simple line-by-line YAML parser for our known structure
  const config: GuardianConfig = {
    notify: { channel: "telegram", target: "", on: "failures" },
    patches: [],
    tests: [],
  };

  let currentSection: "root" | "notify" | "patches" | "tests" = "root";
  let currentItem: any = null;

  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Detect indentation level
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Top-level: guardian:
    if (trimmed === "guardian:") continue;

    // Section headers (indent 2 or 4)
    if (trimmed === "notify:") { currentSection = "notify"; currentItem = null; continue; }
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
        currentItem = {} as any;
        config.patches.push(currentItem);
        // Parse inline key: value
        parseKeyValue(itemContent, currentItem);
        continue;
      }
      if (currentSection === "tests") {
        currentItem = {} as any;
        config.tests.push(currentItem);
        parseKeyValue(itemContent, currentItem);
        continue;
      }
    }

    // Key: value pairs
    if (trimmed.includes(":")) {
      if (currentSection === "notify") {
        parseKeyValue(trimmed, config.notify);
      } else if (currentItem && (currentSection === "patches" || currentSection === "tests")) {
        parseKeyValue(trimmed, currentItem);
      }
    }
  }

  return config;
}

function parseKeyValue(str: string, target: any): void {
  const colonIdx = str.indexOf(":");
  if (colonIdx === -1) return;

  const key = str.slice(0, colonIdx).trim();
  let value = str.slice(colonIdx + 1).trim();

  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  // Remove inline comments
  const commentIdx = value.indexOf(" #");
  if (commentIdx !== -1) {
    // Only strip if not inside quotes (already handled above)
    value = value.slice(0, commentIdx).trim();
    // Re-strip quotes if needed
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
  }

  // Convert numeric values
  if (key === "timeout" && !isNaN(Number(value))) {
    target[key] = Number(value);
  } else {
    target[key] = value;
  }
}

export function loadConfig(workspaceDir: string): GuardianConfig | null {
  const configPath = path.join(workspaceDir, "GUARDIAN.md");
  
  if (!fs.existsSync(configPath)) {
    return null; // No config = no-op
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return parseFrontmatter(content);
  } catch (err) {
    console.error("[claw-guardian] Failed to parse GUARDIAN.md:", err);
    return null;
  }
}
