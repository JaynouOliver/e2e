---
'e2e': patch
---

`e2e init --ci gitlab` renames its jobs beside a `.gitlab-ci.yml` that already has a job of one of their names when that name is quoted or follows a byte order mark, or when the whole file is indented.
