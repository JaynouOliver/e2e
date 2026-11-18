---
'@e2e-dev/web': patch
---

A download whose filename is longer than 64 characters keeps its extension in the saved `path` instead of losing it to the cut.
