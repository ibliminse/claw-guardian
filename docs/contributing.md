# Contributing to claw-guardian

Thanks for considering contributing! claw-guardian is a small, focused project — contributions that keep it simple and reliable are welcome.

## Architecture

claw-guardian has a **dual-source architecture**:

- **`handler.js`** — The self-contained, zero-dependency handler that OpenClaw actually loads. This is what runs in production. It's a single file with no imports except Node.js built-ins.
- **`src/*.ts`** — TypeScript source modules that serve as the reference implementation. These are for readability, documentation, and type safety. They are NOT imported at runtime.

**Why?** OpenClaw hooks load via dynamic import. Depending on internal OpenClaw imports is fragile — they change with every update. By keeping handler.js self-contained with only Node.js built-ins, we guarantee it survives any OpenClaw version change.

## Development Flow

### Setup

```bash
# Clone the repo
git clone https://github.com/dogwiz/claw-guardian
cd claw-guardian

# No npm install needed — zero dependencies!
```

### Making Changes

1. **Edit `handler.js` directly** for production changes. This is the source of truth.
2. **Update `src/*.ts`** to keep the TypeScript reference in sync (if applicable).
3. **Test locally** by copying to your hooks directory:

```bash
# Backup your current handler
cp ~/.openclaw/hooks/claw-guardian/handler.js ~/.openclaw/hooks/claw-guardian/handler.js.bak

# Copy your changes
cp handler.js ~/.openclaw/hooks/claw-guardian/handler.js

# Restart the gateway to test
openclaw gateway restart

# Check the logs
journalctl -u openclaw-gateway --since "1 minute ago" | grep claw-guardian
```

### Testing

There's no test suite (yet). To verify your changes:

1. **Create a GUARDIAN.md** with a known-failing test:
   ```yaml
   ---
   guardian:
     notify:
       channel: telegram
       target: "YOUR_CHAT_ID"
       on: always
     patches: []
     tests:
       - name: "Always passes"
         cmd: "echo ok"
         timeout: 3
       - name: "Always fails"
         cmd: "exit 1"
         timeout: 3
   ---
   ```

2. **Restart the gateway** and verify:
   - The "Always passes" test passes
   - The "Always fails" test fails
   - A Telegram notification arrives
   - Logs show correct output

3. **Test edge cases:**
   - Remove GUARDIAN.md → should be a silent no-op
   - Create a malformed GUARDIAN.md (no frontmatter) → should log a warning, no crash
   - Remove `TELEGRAM_BOT_TOKEN` → should log an error, no crash
   - Restart rapidly 3+ times → should trigger crash loop detection

## Pull Request Guidelines

1. **Keep it simple.** claw-guardian's value is in its simplicity and reliability.
2. **Zero dependencies.** Don't add npm packages. Node.js built-ins only.
3. **Never crash.** Every code path must be wrapped in try/catch. The handler must never throw.
4. **Update handler.js.** This is the production file. TypeScript source is secondary.
5. **Test manually.** Describe what you tested in your PR.
6. **Update docs** if you're adding or changing configuration options.

## What We'd Love Help With

- Additional notification channels (Discord, Slack, webhooks)
- A proper test suite (vitest or similar, but as devDependency only)
- Better YAML parsing (still zero-dep — maybe a more robust regex parser)
- CI/CD pipeline
- More example configs for common setups

## What We Won't Accept

- External runtime dependencies
- Changes that could crash the gateway
- Features that compromise the "works without config" principle
- Anything that imports from `openclaw/*` internals

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
