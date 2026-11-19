---
'@e2e-dev/core': patch
'@e2e-dev/web': patch
---

String text matching drops zero-width spaces and soft hyphens, as Playwright's does: `expect(screen.getByText('Streetname')).toHaveText('Streetname')` now passes on `Street&shy;name`, as do `toContainText` and `toHaveAccessibleName`, and `getByLabel('Streetname')` finds the field `getByRole('textbox', { name: 'Streetname' })` finds. A `RegExp` is still tested against the text as it is.
