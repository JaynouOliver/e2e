---
'e2e': patch
---

`e2e init` in a workspace member with no `packageManager` field or lockfile of its own uses its workspace root's package manager, as `e2e upgrade` does. It used the manager that started it, so `npx e2e init --install` ran `npm install` in a pnpm, Yarn, or Bun workspace and left a stray `package-lock.json`. In a pnpm member, the CI pipeline written by the same run then found that lockfile and installed with `npm ci`. The next steps, the app command of a new Next.js config, and the MCP launcher name the same manager. When the workspace root's manager is not installed, init warns and uses the invoking manager as before. The install lets the lockfile change in CI: pnpm gets `--no-frozen-lockfile` and Yarn `YARN_ENABLE_IMMUTABLE_INSTALLS=false`, as in `e2e upgrade`. A pnpm workspace root with no lockfile yet uses pnpm.
