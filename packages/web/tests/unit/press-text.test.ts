/** The abort ordering of an inserted `press` character, with a page whose focus read answers only after the operation ended. */

import type { Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import type { OperationContext } from '@e2e-dev/core/engine';
import { classifyInputError } from '../../src/actions.ts';
import { insertCharacter } from '../../src/press-text.ts';
import { PlaywrightSurface } from '../../src/surface.ts';

describe('insertCharacter', () => {
  it('does not insert the character once the press has timed out during the focus read', async () => {
    const insertText = vi.fn(async () => undefined);
    const lateFocusRead = (signal: AbortSignal) => new Promise<boolean>((resolve) => signal.addEventListener('abort', () => resolve(true)));
    const operation: OperationContext = { signal: new AbortController().signal, timeoutMs: 20, runId: 'run', attemptId: 'a1', origin: 'test' };
    let insertion: Promise<void> | undefined;

    const press = new PlaywrightSurface({}).guard(operation, 'keyboard.press', ({ signal }) => {
      const page = { frames: () => [{ evaluate: () => lateFocusRead(signal) }], keyboard: { insertText } } as unknown as Page;
      insertion = insertCharacter(page, 'é', signal);
      return insertion;
    }, classifyInputError);

    await expect(press).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED' });
    await expect(insertion).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    expect(insertText).not.toHaveBeenCalled();
  });
});
