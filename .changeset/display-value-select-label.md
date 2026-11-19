---
'@e2e-dev/web': patch
---

`getByDisplayValue` finds a `<select>` by the label of its selected option, the text the control shows, instead of that option's `value` attribute: `<option value="pl">Poland</option>` matches `'Poland'`, no longer `'pl'`. A `multiple` select matches any selected option. `inputValue()` and `toHaveValue` still read the `value` attribute.
