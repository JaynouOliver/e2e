---
'@e2e-dev/core': patch
---

A step label longer than 8192 bytes, such as `app.open` with a long URL or a locator matching a long text, is now cut to that size in the report, so `report.json` stays within the 8192 characters the report-1 schema allows for it.
