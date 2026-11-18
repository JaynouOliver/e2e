---
'@e2e-dev/mobile': patch
---

`device.setNetwork` now fails with `INVALID_ARGUMENT` for a state other than `online` or `offline`. Any other value, such as `'off'`, used to count as `online`: it switched Wi-Fi on on Android and passed without doing anything on iOS.
