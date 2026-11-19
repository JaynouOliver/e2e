/** `press` with a character Playwright's US keyboard layout has no key for, through the engine in a real browser. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LocatorExpression, OperationContext } from '@e2e-dev/core/engine';
import { web } from '../../src/index.ts';
import { ignoreTrace, noSecrets } from '../helpers/secrets.ts';

const PAGE = `<!doctype html><meta charset="utf-8">
<input data-testid="open">
<label>Name <input></label>
<input data-testid="keys" readonly>
<script>
  document.addEventListener('keydown', (event) => {
    document.querySelector('[data-testid=keys]').value += (event.ctrlKey ? 'Control+' : '') + event.key + ';';
  });
</script>`;

const by = (kind: 'testId' | 'label', value: string): LocatorExpression => ({ kind: 'query', query: { kind, value: { kind: 'string', value, exact: true } } });
const OPEN = by('testId', 'open');
/** A label query pins an element handle, where a test id keeps a locator: the two targets `press` dispatches to. */
const LABELLED = by('label', 'Name');

describe('press with a character off the US keyboard layout', () => {
  const engine = web();
  const signal = new AbortController().signal;
  const op: OperationContext = { signal, timeoutMs: 30_000, runId: 'press', attemptId: 'press-1', origin: 'test' };
  const cleanup = { signal, timeoutMs: 30_000 };
  let artifactsDir: string;
  const valueOf = async (expression: LocatorExpression) => (await engine.locate!(expression, op))[0]?.value;
  const press = async (expression: LocatorExpression, key: string) => {
    const [field] = await engine.locate!(expression, op);
    await engine.perform!(field!.ref, { kind: 'press', key }, op);
  };

  beforeAll(async () => {
    artifactsDir = mkdtempSync(path.join(tmpdir(), 'e2e-press-'));
    await engine.init!({ runId: 'press', targetName: 'web', projectRoot: process.cwd(), app: {}, env: {}, headed: false, workerSlot: 0, log: () => undefined, signal });
    await engine.startAttempt!({ attemptId: 'press-1', artifactsDir, signal, resolveSecret: noSecrets, ...ignoreTrace });
  });

  beforeEach(async () => {
    await engine.session!.open!(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`, op);
  });

  afterAll(async () => {
    await engine.endAttempt!(cleanup);
    await engine.dispose!(cleanup);
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  it.each([['a locator', OPEN], ['an element handle', LABELLED]])('types each character into the field %s addresses', async (_target, field) => {
    for (const key of ['e', 'é', 'ß', '€', '中', '😀']) await press(field, key);
    expect(await valueOf(field)).toBe('eéß€中😀');
  });

  it('types the character into the focused field', async () => {
    await press(OPEN, 'a');
    await engine.observe!(op);
    await engine.keyboard!.press('é', op);
    expect(await valueOf(OPEN)).toBe('aé');
  });

  it('still presses a US-layout character with a modifier held', async () => {
    await press(OPEN, 'Control+e');
    expect(await valueOf(by('testId', 'keys'))).toContain('Control+e;');
  });

  it('refuses a modifier with a character it can only insert, before any input', async () => {
    await expect(press(OPEN, 'Control+é')).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    await expect(press(LABELLED, 'Control+é')).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    await engine.observe!(op);
    await expect(engine.keyboard!.press('Shift+é', op)).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect(await valueOf(OPEN)).toBe('');
    expect(await valueOf(LABELLED)).toBe('');
    expect(await valueOf(by('testId', 'keys'))).toBe('');
  });
});
