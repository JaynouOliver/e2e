---
'e2e': patch
---

A failed value matcher now prints `-0`, `NaN`, `Infinity`, `undefined`, bigints, `Map`, `Set`, and errors as themselves, so `expect(-0).toBe(0)` reads `expected -0 to be 0` instead of `expected 0 to be 0`.
