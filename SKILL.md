---
name: claw-guardian
description: "Patch survival + smoke tests for OpenClaw. Never get surprised by a broken agent after an update again."
tags:
  - startup
  - patch
  - smoke-test
  - devops
  - reliability
  - hooks
  - update
---
# 🛡️ claw-guardian

> Patch survival + smoke tests on every OpenClaw gateway startup

## What It Does

Every time your OpenClaw gateway restarts (updates, crashes, manual restart), claw-guardian:

1. **Re-applies patches** — shell commands that survive OpenClaw updates wiping `dist/`
2. **Runs smoke tests** — health checks that verify critical services are alive
3. **Alerts you** — Telegram notification when anything fails

## Install

```bash
# Clone to your hooks directory
git clone https://github.com/ibliminse/claw-guardian ~/.openclaw/hooks/claw-guardian

# Enable the hook
openclaw hooks enable claw-guardian
```

## Configure

Create `GUARDIAN.md` in your workspace root (`~/.openclaw/workspace/GUARDIAN.md`):

```yaml
---
guardian:
  notify:
    channel: telegram
    target: "YOUR_CHAT_ID"
    threadId: "78"           # optional topic id
    on: failures            # "always" | "failures" | "never"
  patches:
    - name: "Fix PATH"
      cmd: "echo 'export PATH=...' >> ~/.bashrc"
      idempotent_check: "grep -q '...' ~/.bashrc"
  tests:
    - name: "Gateway health"
      cmd: "curl -sf http://localhost:18789/health"
      timeout: 5
---
```

## Smoke Tests Included

- Gateway health check
- Cron list parses
- Workspace writable
- Bird CLI auth (if configured)
- Memsearch API responding

## Credits

Inspired by @cptn3mox's post on surviving OpenClaw updates.
Built by @ibliminse.

## License

MIT
