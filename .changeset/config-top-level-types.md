---
'@e2e-dev/core': patch
---

A `projectId` that is not a string, and `credentials` or `secrets` that is not an object, is now `INVALID_CONFIG` when the config loads. `projectId: 123` used to load and fail every test with `WORKER_CRASH`, `credentials: null` threw a raw `TypeError`, and `credentials: 5` was ignored.
