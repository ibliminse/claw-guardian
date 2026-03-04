# 🛡️ claw-guardian

> Never get surprised by a broken agent after an OpenClaw update again.

![version](https://img.shields.io/badge/version-0.1.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![openclaw](https://img.shields.io/badge/openclaw-2026.x+-purple)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

---

## The Problem

OpenClaw updates overwrite everything in `dist/`. That's by design — the update needs a clean slate.

But if you've patched anything — a PATH fix, a custom binary path, a workaround for a known bug — it's gone. Silently. No warning, no changelog entry for your local fix. You come back to a broken agent and spend 20 minutes figuring out that the `bird` CLI can't find its binaries because your PATH export got nuked.

And even when patches aren't the issue, updates can break things. A new version might ship with a regression, a config format change, or a dependency that doesn't play well with your setup. You don't find out until something fails at 3am and your agent goes dark.

**claw-guardian** fixes both problems.

## What claw-guardian does

- **🔧 Re-applies your patches** on every gateway startup — idempotently, so it never double-applies
- **🧪 Runs smoke tests** to verify your critical systems are alive (gateway, Telegram, CLI tools, disk, anything)
- **📲 Alerts you instantly** via Telegram if anything fails — with rate limiting so crash loops don't flood your phone

## Install

```bash
# Manual install (recommended for now):
git clone https://github.com/dogwiz/claw-guardian ~/.openclaw/hooks/claw-guardian
openclaw hooks enable claw-guardian

# Or, once published to npm:
openclaw hooks install claw-guardian
```

That's it. The hook registers itself and fires on every gateway startup.

Verify it's installed:

```bash
openclaw hooks list
# Should show: ✓ ready │ 🛡️ claw-guardian │ Patch survival + smoke tests...
```

## Configure

Create `GUARDIAN.md` in your workspace root (`~/.openclaw/workspace/GUARDIAN.md`):

```markdown
---
guardian:
  notify:
    channel: telegram
    target: "-1003896914252"    # your chat/group id (negative for groups)
    threadId: "78"              # optional: topic id for supergroups
    on: failures                # "always" | "failures" | "never"

  patches:
    - name: "Fix bird PATH"
      cmd: "echo 'export PATH=/home/ubuntu/.npm-global/bin:$PATH' >> ~/.bashrc"
      idempotent_check: "grep -q 'npm-global/bin' ~/.bashrc"

    - name: "Restore custom prompt"
      cmd: "cp ~/backups/system-prompt.md ~/.openclaw/workspace/SYSTEM.md"
      idempotent_check: "diff -q ~/backups/system-prompt.md ~/.openclaw/workspace/SYSTEM.md"

  tests:
    - name: "Gateway health"
      cmd: "curl -sf http://localhost:18789/health"
      timeout: 5

    - name: "Telegram reachable"
      cmd: "curl -sf https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"
      timeout: 10

    - name: "Workspace writable"
      cmd: "touch ~/.openclaw/workspace/.guardian-test && rm ~/.openclaw/workspace/.guardian-test"
      timeout: 3
---

# Guardian Config

Edit the YAML frontmatter above to configure your patches and smoke tests.
This file lives in your workspace and survives OpenClaw updates.
```

**No config?** That's fine. Without a `GUARDIAN.md`, claw-guardian is a silent no-op. Zero friction.

## Smoke Tests

Smoke tests are simple shell commands that verify a service or system is alive. If the command exits `0`, the test passes. Anything else is a failure.

**Why they matter:** After a gateway restart (especially after an update), things can be subtly broken. A database might not have reconnected, an API key might have been rotated, a port might be occupied. Smoke tests catch these immediately instead of letting you discover them hours later when something silently fails.

### Examples

```yaml
tests:
  # Check if the gateway HTTP endpoint is responding
  - name: "Gateway health"
    cmd: "curl -sf http://localhost:18789/health"
    timeout: 5

  # Verify the Telegram bot token is valid
  - name: "Telegram bot alive"
    cmd: "curl -sf https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"
    timeout: 10

  # Confirm the workspace directory is writable
  - name: "Workspace writable"
    cmd: "touch ~/.openclaw/workspace/.test && rm ~/.openclaw/workspace/.test"
    timeout: 3

  # Verify a custom CLI tool is accessible
  - name: "Bird CLI auth"
    cmd: "source ~/.openclaw/workspace/skills/shared/bird-env.sh && bird whoami"
    timeout: 10

  # Check disk space (fail if <1GB free)
  - name: "Disk space OK"
    cmd: "test $(df / --output=avail | tail -1) -gt 1048576"
    timeout: 3

  # Verify cron system is functional
  - name: "Cron parses"
    cmd: "openclaw cron list --json > /dev/null 2>&1"
    timeout: 8
```

Each test has:
- **`name`** — Human-readable label (shown in alerts)
- **`cmd`** — Shell command to run (bash). Exit 0 = pass, anything else = fail
- **`timeout`** — Seconds before the test is killed and marked as timed out (default: 10)

## Patches

Patches are shell commands that re-apply changes that would otherwise be wiped by `openclaw update`. Each patch runs idempotently — it checks before it applies, so it's safe to run on every startup.

### How idempotency works

1. **Daily tracking:** Once a patch is successfully applied, it's tracked in `/tmp/.guardian-patches-<date>.json`. If the same patch was already applied today, it's skipped — even without an `idempotent_check`.

2. **Explicit check:** If `idempotent_check` is set, that command runs first. Exit 0 means "already applied, skip." This is the most reliable method.

3. **Both together:** Daily tracking provides a fast path. `idempotent_check` provides correctness. Use both when possible.

### Examples

```yaml
patches:
  # Re-add PATH export that gets wiped
  - name: "Fix bird PATH"
    cmd: "echo 'export PATH=/home/ubuntu/.npm-global/bin:$PATH' >> ~/.bashrc"
    idempotent_check: "grep -q 'npm-global/bin' ~/.bashrc"

  # Restore a custom config file from backup
  - name: "Restore webhook config"
    cmd: "cp ~/backups/webhook.json ~/.openclaw/config/webhook.json"
    idempotent_check: "diff -q ~/backups/webhook.json ~/.openclaw/config/webhook.json"

  # Apply a sed patch to a dist file
  - name: "Fix rate limit in dist"
    cmd: "sed -i 's/rateLimit: 100/rateLimit: 500/' ~/.npm-global/lib/node_modules/openclaw/dist/server.js"
    idempotent_check: "grep -q 'rateLimit: 500' ~/.npm-global/lib/node_modules/openclaw/dist/server.js"

  # Symlink a custom skill
  - name: "Link custom skill"
    cmd: "ln -sf ~/my-skills/custom-skill ~/.openclaw/workspace/skills/custom-skill"
    idempotent_check: "test -L ~/.openclaw/workspace/skills/custom-skill"
```

Each patch has:
- **`name`** — Human-readable label
- **`cmd`** — Shell command to run (bash). 30s timeout.
- **`idempotent_check`** *(optional)* — Command that exits 0 if the patch is already applied

## Notifications

claw-guardian sends Telegram alerts when something fails. It uses the Telegram Bot API directly — no dependencies.

### Setup

1. **Create a bot** (if you don't have one): Talk to [@BotFather](https://t.me/botfather) on Telegram, run `/newbot`, save the token.

2. **Set the token** as an environment variable:
   ```bash
   # In ~/.config/env/global.env (or wherever your env vars live):
   export TELEGRAM_BOT_TOKEN="1234567890:ABCdefGhIjKlMnOpQrStUvWxYz"
   ```

3. **Find your chat_id:**
   - For DMs: Send any message to your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` — your chat_id is in the response.
   - For groups: Add the bot to the group, send a message, check `getUpdates`. Group IDs are negative numbers.

4. **Find your thread_id** (for supergroup topics):
   - Send a message in the topic you want alerts in
   - Check `getUpdates` — the `message_thread_id` field is your thread_id

5. **Configure in GUARDIAN.md:**
   ```yaml
   notify:
     channel: telegram
     target: "-1003896914252"  # chat or group id
     threadId: "78"            # optional topic id
     on: failures              # "always" | "failures" | "never"
   ```

### Notification modes

| Mode | Behavior |
|------|----------|
| `failures` | Only alert when a test fails or a patch fails (default) |
| `always` | Send a brief ✅ on success, detailed alert on failure |
| `never` | Disable notifications entirely |

### Rate limiting

- Notifications are rate-limited to **1 per 60 seconds** to prevent spam during rapid restarts.
- **Crash loop detection:** If the gateway restarts 3+ times in 5 minutes, claw-guardian sends one summary alert and suppresses further individual notifications until the loop stops.

## How It Works (Under the Hood)

claw-guardian is an OpenClaw hook that fires on the `gateway:startup` event. When the gateway starts:

```
gateway:startup event fires
       ↓
claw-guardian handler runs
       ↓
1. Load GUARDIAN.md from workspace root
   (no config → silent no-op)
       ↓
2. Run patches in order
   - Check daily tracking → skip if applied today
   - Check idempotent_check → skip if passes
   - Apply patch → track success
       ↓
3. Run smoke tests in order
   - Each test: shell command with timeout
   - Capture pass/fail + reason
       ↓
4. Report
   - All pass + on:"failures" → silent
   - All pass + on:"always" → brief ✅
   - Any fail → Telegram alert (rate-limited)
```

### Safety guarantees

- **Never crashes the gateway.** Every single operation is wrapped in try/catch. The top-level handler has a safety wrapper that catches even unexpected throws. A crashed hook can destabilize gateway startup — claw-guardian logs errors to stderr and moves on.
- **Never double-applies patches.** Daily tracking + idempotency checks ensure patches are applied exactly once per day.
- **Never spams you.** 60-second rate limiting + crash loop detection prevent notification floods.
- **Zero dependencies.** Pure Node.js built-ins (`fs`, `child_process`, `https`). No `node_modules`. No npm packages. Nothing to break.
- **Works without config.** No GUARDIAN.md = no-op. Install it and configure later.

## File Structure

```
claw-guardian/
├── README.md          # You're reading it
├── CHANGELOG.md       # Version history
├── LICENSE            # MIT
├── package.json       # npm/OpenClaw hook metadata
├── HOOK.md            # OpenClaw hook registration
├── handler.js         # The actual hook (self-contained, no deps)
├── handler.ts         # TypeScript source (for reference/contribution)
├── tsconfig.json      # TypeScript config
├── src/               # TypeScript modules (reference implementation)
│   ├── config.ts      # GUARDIAN.md parser
│   ├── patches.ts     # Patch runner
│   ├── tests.ts       # Smoke test runner
│   └── notify.ts      # Telegram notifier
├── examples/
│   └── GUARDIAN.md    # Full example config with comments
└── docs/
    ├── install.md     # Installation guide
    ├── config.md      # Configuration reference
    └── contributing.md # How to contribute
```

## FAQ

**Q: Does claw-guardian survive `openclaw update`?**
A: Yes. It lives in `~/.openclaw/hooks/`, which is NOT part of the `dist/` directory that gets overwritten. That's the whole point.

**Q: What if GUARDIAN.md has a syntax error?**
A: claw-guardian logs a warning and does nothing. It never crashes.

**Q: Can I run it manually to test?**
A: Restart the gateway: `openclaw gateway restart`. claw-guardian fires on every startup.

**Q: What if I don't want notifications?**
A: Set `on: never` in the notify config, or just don't set a `target`. No target = no notifications.

**Q: Does it slow down gateway startup?**
A: Minimally. Tests run sequentially with configurable timeouts. A typical 5-test suite completes in under 10 seconds.

## Credits

Inspired by [@cptn3mox](https://x.com/cptn3mox)'s post on surviving OpenClaw updates:
https://x.com/cptn3mox/status/2028763668826235114

Built by [@dogwiz](https://x.com/dogwiz) from firsthand experience running a 5-agent OpenClaw stack in production. If you've ever come back to a broken agent after an update with no idea why — this is for you.

## License

MIT — see [LICENSE](LICENSE) for details.
