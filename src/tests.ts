/**
 * tests.ts — Smoke test runner
 * Runs configurable shell commands and captures pass/fail status.
 * Never throws — all errors caught and logged.
 */

import { execSync } from "node:child_process";

export interface TestConfig {
  name: string;
  cmd: string;
  timeout?: number; // seconds, default 10
}

export interface TestResult {
  name: string;
  passed: boolean;
  reason?: string;
  durationMs: number;
}

export function runTests(tests: TestConfig[]): TestResult[] {
  const results: TestResult[] = [];

  for (const test of tests) {
    const start = Date.now();
    const timeoutMs = (test.timeout || 10) * 1000;

    try {
      execSync(test.cmd, {
        timeout: timeoutMs,
        stdio: "pipe",
        shell: "/bin/bash",
        env: { ...process.env, PATH: `/home/ubuntu/.npm-global/bin:${process.env.PATH}` },
      });

      results.push({
        name: test.name,
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (err: any) {
      let reason = "Unknown error";

      if (err.killed) {
        reason = `Timed out after ${test.timeout || 10}s`;
      } else if (err.stderr && err.stderr.toString().trim()) {
        reason = err.stderr.toString().trim().slice(0, 200);
      } else if (err.message) {
        reason = err.message.slice(0, 200);
      }

      results.push({
        name: test.name,
        passed: false,
        reason,
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}
