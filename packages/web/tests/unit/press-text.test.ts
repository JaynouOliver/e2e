/** Which `press` keys are inserted as text, the checkpoint between the focus read and the insertion, and a focused field the page disabled. */

import type { Locator as PwLocator, Page } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { insertCharacter, insertCharacterInto, requireInsertableCharacter } from '../../src/press-text.ts';

describe('requireInsertableCharacter', () => {
  it.each([' ', '~', 'a', '$', '+', 'Enter', 'Control+a', 'Shift++', 'Shift+Tab'])('leaves %j to a key press', (key) => {
    expect(requireInsertableCharacter(key)).toBeUndefined();
  });

  it.each(['é', 'ß', '€', '中', '😀', '\u00a0', '¡'])('inserts %j as text', (key) => {
    expect(requireInsertableCharacter(key)).toBe(key);
  });

  it.each(['Control+é', 'Shift+é', 'ControlOrMeta+Alt+中'])('refuses %j, which has no key to hold a modifier over', (key) => {
    expect(() => requireInsertableCharacter(key)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }));
  });
});

describe('the checkpoint of an inserted character', () => {
  const stale = new Error('stale');
  const fakePage = () => {
    const calls: string[] = [];
    const insertText = vi.fn(async () => { calls.push('insert'); });
    const page = { frames: () => [{ evaluate: async () => { calls.push('focus read'); return true; } }], keyboard: { insertText } } as unknown as Page;
    return { calls, insertText, page, checkpoint: () => { calls.push('checkpoint'); } };
  };
  const focusedLocator = { focus: async () => undefined, evaluate: async () => true } as unknown as PwLocator;
  const OPERATION = { timeoutMs: 7, signal: new AbortController().signal };

  it('runs after the focus read and before the insertion', async () => {
    const { calls, page, checkpoint } = fakePage();
    await insertCharacter(page, 'é', checkpoint);
    expect(calls).toEqual(['focus read', 'checkpoint', 'insert']);
  });

  it.each([
    ['the focused element', (page: Page, checkpoint: () => void) => insertCharacter(page, 'é', checkpoint)],
    ['a node', (page: Page, checkpoint: () => void) => insertCharacterInto({ kind: 'locator', locator: focusedLocator }, page, 'é', OPERATION, checkpoint)],
  ])('inserts nothing into %s when it throws', async (_target, insert) => {
    const { insertText, page } = fakePage();
    await expect(insert(page, () => { throw stale; })).rejects.toBe(stale);
    expect(insertText).not.toHaveBeenCalled();
  });
});

describe('a focused field the page disabled', () => {
  // Chromium blurs a disabled field a moment after, too soon for a real page to hold the state under test.
  class Field { shadowRoot = null; type = 'text'; readOnly = false; constructor(readonly disabled: boolean) {} }
  class Input extends Field {}
  class TextArea extends Field {}
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['a disabled input', Input, true],
    ['a disabled textarea', TextArea, true],
    ['an enabled input', Input, false],
    ['an enabled textarea', TextArea, false],
  ])('inserts only into an enabled field: %s', async (_field, Kind, disabled) => {
    vi.stubGlobal('HTMLInputElement', Input);
    vi.stubGlobal('HTMLTextAreaElement', TextArea);
    vi.stubGlobal('document', { hasFocus: () => true, activeElement: new Kind(disabled) });
    const insertText = vi.fn(async () => undefined);
    const page = { frames: () => [{ evaluate: async (read: (key: string) => boolean, key: string) => read(key) }], keyboard: { insertText } } as unknown as Page;
    const insertion = insertCharacter(page, 'é', () => undefined);
    await (disabled ? expect(insertion).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' }) : insertion);
    expect(insertText).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });
});
