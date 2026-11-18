---
'e2e': patch
---

The markdown report and the trace pages show a `|` inside a code span as written instead of as `\|`: a step label such as ``getByRole("button", name: /Save|Submit/)`` no longer gains a backslash. The pipe is still escaped in table rows.
