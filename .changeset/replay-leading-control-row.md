---
"@e2e-dev/core": patch
---

A repeated control that is the first thing in its row, list item, or card (an `Archive` button in a table's first column) is now recorded by its row, so a replay on a reordered list no longer acts on another row. Entries already recorded by place keep replaying by place until the step is recorded again.
