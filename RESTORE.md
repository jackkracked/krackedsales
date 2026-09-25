# ⚠️ `node_modules` was cleared to free disk space

**Date:** 2026-08-02

**What happened:** The `node_modules/` folder in this project was deleted to reclaim disk space
during a full-disk situation. **No source code, data, config, database, or git history was
changed** — only the auto-downloaded dependency folder was removed.

**Is anything broken?** No. This project is simply in the same "fresh download" state every JS
project is in before its first run. Nothing was lost — `node_modules` is regenerated from
`package.json` (which is untouched).

**To restore (takes ~2 minutes):**

```bash
npm install
```

Run that command *in this folder* and the app is back exactly as it was.

_If this project uses a different package manager, use its equivalent — check which lockfile is
present: `package-lock.json` → `npm install` · `pnpm-lock.yaml` → `pnpm install` ·
`yarn.lock` → `yarn` · `bun.lockb` → `bun install`._

You can delete this note after restoring.
