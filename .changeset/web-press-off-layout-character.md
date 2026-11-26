---
'@e2e-dev/web': patch
---

`press` with a single character that is not on a US keyboard (`é`, `ß`, `€`, `中`, an emoji) inserts it into an editable text field or contenteditable node instead of failing with `ENGINE_FAILURE: Unknown key`. The page gets `beforeinput` and `input` but no `keydown`, `keypress`, or `keyup`. On any other node (a button, a select, a number or read-only input) it fails as `ACTION_FAILED`, and with a modifier (`Control+é`) it is `UNSUPPORTED_CAPABILITY` before any key is sent.
