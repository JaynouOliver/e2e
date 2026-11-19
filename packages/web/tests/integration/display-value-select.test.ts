/**
 * A display-value query finds a select by the option it shows, not by the
 * `value` attribute that option submits; the node still reports that
 * attribute as its value. The fixture is `/selects`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineCleanupContext, EngineHandle, LocatorExpression, OperationContext } from '@e2e-dev/core/engine';
import { web } from '../../src/index.ts';
import { startFixtureApp, type FixtureApp } from '../helpers/fixture-app.ts';
import { ignoreTrace, noSecrets } from '../helpers/secrets.ts';

function cleanup(): EngineCleanupContext {
  return { signal: new AbortController().signal, timeoutMs: 30_000 };
}

function operation(attemptId: string): OperationContext {
  return { signal: new AbortController().signal, timeoutMs: 30_000, runId: 'run-selects', attemptId, origin: 'test' };
}

function byDisplayValue(value: string, exact = true): LocatorExpression {
  return { kind: 'query', query: { kind: 'displayValue', value: { kind: 'string', value, exact } } };
}

async function boot(engine: EngineHandle, app: FixtureApp): Promise<void> {
  await engine.init!({
    runId: 'run-selects',
    targetName: 'web',
    projectRoot: process.cwd(),
    app: { site: new URL(app.url).hostname },
    env: {},
    headed: false,
    workerSlot: 0,
    log: () => undefined,
    signal: new AbortController().signal,
  });
}

describe('a display-value query on a select', () => {
  let app: FixtureApp;
  let artifactsDir: string;
  const engine = web();
  const op = operation('selects-1');
  const locate = (expression: LocatorExpression) => engine.locate!(expression, op);
  const testIds = (expression: LocatorExpression) => locate(expression).then((nodes) => nodes.map((node) => node.testId));

  beforeAll(async () => {
    app = await startFixtureApp();
    artifactsDir = mkdtempSync(path.join(tmpdir(), 'e2e-selects-'));
    await boot(engine, app);
    await engine.startAttempt!({ attemptId: 'selects-1', artifactsDir, signal: new AbortController().signal, resolveSecret: noSecrets, ...ignoreTrace });
    await engine.session!.open!(`${app.url}/selects`, op);
  });

  afterAll(async () => {
    await engine.endAttempt!(cleanup());
    await engine.dispose!(cleanup());
    await app.close();
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  it('matches the selected option as shown, and leaves its value attribute to the input that shows it', async () => {
    expect(await testIds(byDisplayValue('Poland'))).toEqual(['country']);
    expect(await testIds(byDisplayValue('pl'))).toEqual(['code']);
    expect(await testIds(byDisplayValue('Germany'))).toEqual([]);
    expect(await testIds(byDisplayValue('pol', false))).toEqual(['country']);
  });

  it('keeps the value attribute as the node value', async () => {
    const [country] = await locate(byDisplayValue('Poland'));
    expect(country).toMatchObject({ role: 'combobox', name: 'Country', value: 'pl' });
  });

  it('matches a placeholder option, and reads the label attribute the browser shows over the option text', async () => {
    expect(await testIds(byDisplayValue('Choose a plan'))).toEqual(['plan']);
    const [plan] = await locate(byDisplayValue('Choose a plan'));
    await engine.perform!(plan!.ref, { kind: 'selectOption', value: { value: 'pro' } }, op);
    expect(await testIds(byDisplayValue('Pro'))).toEqual(['plan']);
    expect(await testIds(byDisplayValue('Professional'))).toEqual([]);
    expect(await testIds(byDisplayValue('Choose a plan'))).toEqual([]);
  });

  it('matches a multiple select by any selected option', async () => {
    expect(await testIds(byDisplayValue('Ham'))).toEqual(['toppings']);
    expect(await testIds(byDisplayValue('Mushrooms'))).toEqual(['toppings']);
    expect(await testIds(byDisplayValue('Olives'))).toEqual([]);
    expect(await testIds(byDisplayValue('Unpicked'))).toEqual([]);
  });

  it('matches a select with nothing selected by the empty value', async () => {
    expect(await testIds(byDisplayValue(''))).toEqual(['none', 'empty']);
  });
});
