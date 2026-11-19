/**
 * A zero-width space or a soft hyphen renders as nothing, so every query
 * reads a name, a label, and a text without it: the exact label query, which
 * the engine matches itself, finds the control the role and text queries find.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineCleanupContext, EngineHandle, LocatorExpression, OperationContext, SemanticQuery } from '@e2e-dev/core/engine';
import { surfaceOf, web } from '../../src/index.ts';
import { startFixtureApp, type FixtureApp } from '../helpers/fixture-app.ts';
import { ignoreTrace, noSecrets } from '../helpers/secrets.ts';

const PAGE = `
  <label for="street">Street&shy;name</label><input id="street" data-testid="street">
  <input aria-label="Post&#8203;code" data-testid="postcode">
  <label>Street&shy;name 2 <input data-testid="street-2"></label>
  <p data-testid="total">Total&#8203;: 42</p>
`;

function cleanup(): EngineCleanupContext {
  return { signal: new AbortController().signal, timeoutMs: 30_000 };
}

function operation(): OperationContext {
  return { signal: new AbortController().signal, timeoutMs: 30_000, runId: 'run-invisible', attemptId: 'invisible-1', origin: 'test' };
}

function query(kind: 'label' | 'text', value: string): LocatorExpression {
  return { kind: 'query', query: { kind, value: { kind: 'string', value, exact: true } } };
}

function textbox(name: string): LocatorExpression {
  const role: SemanticQuery = { kind: 'role', value: { kind: 'string', value: 'textbox', exact: true }, name: { kind: 'string', value: name, exact: true } };
  return { kind: 'query', query: role };
}

describe('zero-width spaces and soft hyphens in names, labels, and text', () => {
  let app: FixtureApp;
  let artifactsDir: string;
  const engine: EngineHandle = web();
  const op = operation();
  const testIds = (expression: LocatorExpression) => engine.locate!(expression, op).then((nodes) => nodes.map((node) => node.testId));

  beforeAll(async () => {
    app = await startFixtureApp();
    artifactsDir = mkdtempSync(path.join(tmpdir(), 'e2e-invisible-'));
    await engine.init!({
      runId: 'run-invisible', targetName: 'web', projectRoot: process.cwd(),
      app: { site: new URL(app.url).hostname }, env: {}, headed: false,
      workerSlot: 0, log: () => undefined, signal: new AbortController().signal,
    });
    await engine.startAttempt!({ attemptId: 'invisible-1', artifactsDir, signal: new AbortController().signal, resolveSecret: noSecrets, ...ignoreTrace });
    await engine.session!.open!(`${app.url}/login`, op);
    await surfaceOf(engine)!.page().setContent(PAGE);
  });

  afterAll(async () => {
    await engine.endAttempt!(cleanup());
    await engine.dispose!(cleanup());
    await app.close();
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  it('finds a control by its label as it finds it by role and name', async () => {
    expect(await testIds(textbox('Streetname'))).toEqual(['street']);
    expect(await testIds(query('label', 'Streetname'))).toEqual(['street']);
    expect(await testIds(textbox('Postcode'))).toEqual(['postcode']);
    expect(await testIds(query('label', 'Postcode'))).toEqual(['postcode']);
  });

  it('takes the label written with the character too, and stays exact', async () => {
    expect(await testIds(query('label', 'Street\u00adname'))).toEqual(['street']);
    expect(await testIds(query('label', 'Street name'))).toEqual([]);
    expect(await testIds(query('label', 'Streetname 2'))).toEqual(['street-2']);
  });

  it('finds text the same way', async () => {
    expect(await testIds(query('text', 'Total: 42'))).toEqual(['total']);
  });
});
