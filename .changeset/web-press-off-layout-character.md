---
'@e2e-dev/web': patch
---

`press` with a single character that is not on a US keyboard (`é`, `ß`, `€`, `中`, an emoji) now types it into the field, as the key grammar says, instead of failing with `ENGINE_FAILURE: Unknown key`. Such a character has no key to hold a modifier over, so `Control+é` is `UNSUPPORTED_CAPABILITY`.
