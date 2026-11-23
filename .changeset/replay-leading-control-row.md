---
"@e2e-dev/core": patch
---

A repeated control that is the first thing in its row (an `Archive` button in a table's first column) is now recorded by the row's next text when that text tells the rows apart, so a replay on a reordered list no longer acts on another row. Rows the next text does not tell apart are still replayed by place. Entries already recorded by place keep replaying by place until the step is recorded again.
