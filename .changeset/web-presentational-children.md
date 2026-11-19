---
'@e2e-dev/web': patch
---

Rows, cells, and list items under a `role="presentation"` or `role="none"` table or list no longer appear in the tree as `row`, `cell`, or `listitem`, roles `getByRole` never matched there. They read as presentational, the way Chrome and Playwright read them.
