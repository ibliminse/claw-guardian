---
name: claw-guardian
description: "Patch survival + smoke tests on every gateway startup. Never get surprised by a broken agent after an update again."
homepage: https://github.com/dogwiz/claw-guardian
metadata:
  {
    "openclaw": {
      "emoji": "🛡️",
      "events": ["gateway:startup"],
      "requires": { "config": ["workspace.dir"] }
    }
  }
---

# claw-guardian

Runs on every gateway startup to re-apply patches and verify critical systems.
See GUARDIAN.md in your workspace to configure patches and smoke tests.
