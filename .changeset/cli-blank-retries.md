---
'e2e': patch
---

`e2e run --retries ''` is now a usage error (exit 2) instead of a run with no retries, so `--retries "$RETRIES"` with the variable unset no longer turns the config's retries off. An empty `--workers` fails the same way.
