# Installation Guide

## Prerequisites

- [OpenClaw](https://github.com/nichochar/openclaw) 2026.x or later
- Node.js 18+
- A Telegram bot token (for notifications)

## Install from GitHub

```bash
git clone https://github.com/dogwiz/claw-guardian ~/.openclaw/hooks/claw-guardian
openclaw hooks enable claw-guardian
```

## Install from npm (when published)

```bash
openclaw hooks install claw-guardian
```

## Verify Installation

```bash
openclaw hooks list
# Should show: ✓ ready │ 🛡️ claw-guardian │ Patch survival + smoke tests...

openclaw hooks info claw-guardian
# Shows full hook metadata
```

## Configure

1. Copy the example config to your workspace:

```bash
cp ~/.openclaw/hooks/claw-guardian/examples/GUARDIAN.md ~/.openclaw/workspace/GUARDIAN.md
```

2. Edit `~/.openclaw/workspace/GUARDIAN.md` with your patches, tests, and notification settings.

3. Restart the gateway to trigger:

```bash
openclaw gateway restart
```

## Uninstall

```bash
openclaw hooks disable claw-guardian
rm -rf ~/.openclaw/hooks/claw-guardian
```

Your `GUARDIAN.md` in workspace is untouched — you can reinstall later without reconfiguring.

## Upgrading

```bash
cd ~/.openclaw/hooks/claw-guardian
git pull
```

claw-guardian has zero dependencies, so there's no `npm install` needed.
