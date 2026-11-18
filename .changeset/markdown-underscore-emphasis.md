---
'e2e': patch
---

The markdown report escapes an underscore at the edge of a word, so a path like `tests/__tests__/login.e2e.ts` or a title like `__proto__ is not polluted` shows as written on GitHub instead of turning bold or italic. An underscore inside a word, as in `ASSERTION_FAILED`, is left alone.
