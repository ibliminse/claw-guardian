---
guardian:
  notify:
    channel: telegram
    target: "-1001234567890"    # your chat/group id (negative for groups)
    threadId: ""                # optional: topic id for supergroups
    on: failures                # "always" | "failures" | "never"

  patches:
    # Re-add a PATH export that gets wiped by openclaw update
    - name: "Fix bird PATH"
      cmd: "echo 'export PATH=/home/ubuntu/.npm-global/bin:$PATH' >> ~/.bashrc"
      idempotent_check: "grep -q 'npm-global/bin' ~/.bashrc"

    # Restore a custom config from backup
    - name: "Restore webhook config"
      cmd: "cp ~/backups/webhook.json ~/.openclaw/config/webhook.json"
      idempotent_check: "diff -q ~/backups/webhook.json ~/.openclaw/config/webhook.json"

    # Patch a dist file directly (re-applied after every update)
    - name: "Fix rate limit in dist"
      cmd: "sed -i 's/rateLimit: 100/rateLimit: 500/' ~/.npm-global/lib/node_modules/openclaw/dist/server.js"
      idempotent_check: "grep -q 'rateLimit: 500' ~/.npm-global/lib/node_modules/openclaw/dist/server.js"

  tests:
    # Check if the gateway HTTP endpoint is responding
    - name: "Gateway health"
      cmd: "curl -sf http://localhost:18789/health"
      timeout: 5

    # Verify cron system is functional
    - name: "Cron parses"
      cmd: "openclaw cron list --json > /dev/null 2>&1"
      timeout: 8

    # Confirm workspace directory is writable
    - name: "Workspace writable"
      cmd: "touch ~/.openclaw/workspace/.guardian-test && rm ~/.openclaw/workspace/.guardian-test"
      timeout: 3

    # Verify a custom CLI tool is accessible
    - name: "Bird CLI auth"
      cmd: "source ~/.openclaw/workspace/skills/shared/bird-env.sh && bird whoami"
      timeout: 10

    # Check disk space (fail if <1GB free on /)
    - name: "Disk space OK"
      cmd: "test $(df / --output=avail | tail -1) -gt 1048576"
      timeout: 3
---

# Guardian Config

This is an example GUARDIAN.md for claw-guardian.
Copy this file to your workspace root (`~/.openclaw/workspace/GUARDIAN.md`) and customize.

## Patches
Add shell commands to re-apply after openclaw updates wipe dist/.
Each patch has an optional `idempotent_check` — if it exits 0, the patch is skipped.

## Tests
Add smoke tests to verify critical services are alive after gateway startup.
Each test is a shell command: exit 0 = pass, anything else = fail.
Set `timeout` in seconds (default: 10).

## Notifications
Set `on: failures` to only get alerted when something breaks.
Set `on: always` to get a ✅ confirmation on every clean startup.
Set `on: never` to disable notifications entirely.
