---
'e2e': patch
'@e2e-dev/core': patch
---

The JUnit report keeps carriage returns in failure messages instead of writing U+FFFD. An error message with `\r\n` line breaks now reads `&#13;&#10;` in `junit.xml`, and `report.json` keeps the `\r`. The terminal output is unchanged.
