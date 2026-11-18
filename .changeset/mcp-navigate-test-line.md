---
'e2e': patch
---

An `e2e mcp` session no longer prints a `navigate` test line that opens another URL: a URL whose path starts with `//`, or one that carries credentials, stays as given instead of being cut to its path.
