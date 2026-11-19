---
'@e2e-dev/core': patch
---

A secret value in an `app.screenshot()` label or an `app.startRecording()` name no longer ends up in the file name. The file is named with `<secret:name>` made filename-safe, such as `001-signed-in-_secret_apiKey_.png`, so the artifact path in `report.json`, the trace page, and the summaries holds no secret.
