---
'e2e': patch
---

A flaky serial group member that passed in the failed group attempt no longer reads `flaky: 0 failed attempts before passing` in `junit.xml`, `0 failed attempts first` in the Markdown summary, and `Passed after 0 failed attempts` on its trace page. It counts the group's failed attempts, like the members that failed or were skipped in them.
