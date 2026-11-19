---
'e2e': patch
---

`e2e init` in a workspace member installs with the workspace root's package manager. Started with `npx`, it ran `npm install` in a pnpm, Yarn, or Bun workspace whose lockfile and `packageManager` field are at the root. In a pnpm workspace that left a `package-lock.json` in the member, and the CI pipeline it wrote installed with `npm ci`. The next steps it prints name the same manager.
