---
"@e2e-dev/core": patch
---

A recorded control that shares its name with others and is the first text in its row, list item, or card (an `Archive` button in a table's first column) is now recorded with that row, by the row's first text outside the control, when that text tells it from the other rows' controls. Before, the row's first text was the control's own name, which keys nothing, so the recording kept only the control's place among its twins (`2 of 5`), and a replay on a list of the same length in another order acted on another row's control. Entries already recorded by place keep replaying by place until the step is recorded again.
