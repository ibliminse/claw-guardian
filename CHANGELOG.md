# Changelog

All notable changes to claw-guardian will be documented in this file.

## 0.1.0 — 2026-03-03

Initial release.

- Gateway startup hook (`gateway:startup` event)
- Configurable patch runner with idempotency checks
- Daily patch tracking (`/tmp/.guardian-patches-<date>.json`) — patches applied once per day even without explicit idempotent_check
- Smoke test runner with per-test configurable timeouts
- Telegram failure notifications via Bot API (zero dependencies)
- 60-second rate limiting on notifications
- Crash loop detection — suppresses notification flood when gateway restarts 3+ times in 5 minutes
- Silent pass mode — no notification when everything passes (configurable via `on: "always"` for success messages)
- Top-level safety wrapper — handler NEVER throws, even on unexpected errors
- Graceful degradation — works without GUARDIAN.md (silent no-op), without Telegram token (logs warning), without workspace dir (logs warning)
- Zero dependencies — pure Node.js built-ins only (`fs`, `child_process`, `https`)
- Works with OpenClaw 2026.x+
