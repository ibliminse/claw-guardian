# Configuration Reference

claw-guardian is configured via `GUARDIAN.md` in your workspace root (`~/.openclaw/workspace/GUARDIAN.md`). The file uses YAML frontmatter for configuration and Markdown body for documentation/notes.

## Full Schema

```yaml
---
guardian:
  notify:
    channel: telegram          # Only "telegram" supported currently
    target: "<chat_id>"        # Telegram chat or group ID (string)
    threadId: "<thread_id>"    # Optional: supergroup topic ID (string)
    on: failures               # "always" | "failures" | "never"

  patches:
    - name: "<display name>"          # Required: human-readable label
      cmd: "<shell command>"          # Required: bash command to run
      idempotent_check: "<command>"   # Optional: exits 0 if already applied

  tests:
    - name: "<display name>"          # Required: human-readable label
      cmd: "<shell command>"          # Required: exits 0 = pass
      timeout: 10                     # Optional: seconds (default: 10)
---
```

## Notify

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `channel` | string | `"telegram"` | Notification channel (only telegram supported) |
| `target` | string | — | Chat/group ID. Negative for groups. Required for notifications. |
| `threadId` | string | — | Topic ID for supergroup topics. Optional. |
| `on` | string | `"failures"` | When to notify: `always`, `failures`, or `never` |

### Finding your chat ID

- **DMs:** Send a message to your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
- **Groups:** Add the bot to the group, send a message, check `getUpdates`. Group IDs are negative.
- **Topics:** The `message_thread_id` field in `getUpdates` is your `threadId`.

### Bot token discovery

claw-guardian finds your Telegram bot token automatically via fallback chain:

1. `$TELEGRAM_BOT_TOKEN` environment variable
2. `~/.config/env/global.env` (sourced)
3. `~/.openclaw/config/openclaw.json` → `channels.telegram.accounts.default.botToken`

## Patches

Patches are shell commands that re-apply changes wiped by `openclaw update`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable label |
| `cmd` | string | Yes | Bash command to execute (30s timeout) |
| `idempotent_check` | string | No | Command that exits 0 if patch is already applied |

### Idempotency

Two layers prevent double-application:

1. **Daily tracking:** Applied patches are recorded in `/tmp/.guardian-patches-<YYYY-MM-DD>.json`. Same patch won't re-apply on the same calendar day.
2. **Explicit check:** If `idempotent_check` is set and exits 0, the patch is skipped regardless of daily tracking.

## Tests

Smoke tests verify systems are alive after gateway startup.

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `name` | string | — | Yes | Human-readable label |
| `cmd` | string | — | Yes | Bash command. Exit 0 = pass. |
| `timeout` | number | `10` | No | Seconds before test is killed |

Tests run sequentially in the order defined. A failed test does not prevent subsequent tests from running.

## No Config

If `GUARDIAN.md` doesn't exist in the workspace, claw-guardian is a silent no-op. No patches, no tests, no notifications. This is by design — install first, configure later.

## Rate Limiting

- Notifications are rate-limited to 1 per 60 seconds.
- If 3+ gateway restarts occur within 5 minutes, crash loop detection activates and sends one summary alert.
