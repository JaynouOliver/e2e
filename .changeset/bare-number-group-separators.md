---
'@e2e-dev/core': patch
---

A replay no longer goes stale over a tally written with group separators, such as `1,204`, `1.204` or `1 204`: it is skipped like `204` when the step has a stable result.
