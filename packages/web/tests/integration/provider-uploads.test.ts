/**
 * Uploads to a browser provider's browser, against a real Chrome over CDP:
 * its filesystem is another machine's, so the engine sends the files' bytes
 * into the page instead of their paths, and the page's input gets the same
 * files, names, types, and events a person picking them would give it.
 */

import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EngineHandle, JsonValue, OperationContext } from '@e2e-dev/core/engine';
import { web as webEngine, type BrowserProvider } from '../../src/index.ts';
import { closeRemoteChrome, launchRemoteChrome, type RemoteChrome } from '../helpers/cdp-host.ts';
import { startFixtureApp, type FixtureApp } from '../helpers/fixture-app.ts';
import { ignoreTrace, noSecrets } from '../helpers/secrets.ts';
import { browserFixture, bySelector } from '../helpers/web-session.ts';

function operation(): OperationContext {
  return { timeoutMs: 15_000, signal: new AbortController().signal, runId: 'run-uploads', attemptId: 'a1', origin: 'test' };
}

function cleanup() {
  return { timeoutMs: 10_000, signal: new AbortController().signal };
}

const signal = () => new AbortController().signal;

/** Records every change of each file input on the page: the files' names, types, and text, and the events that fired. */
const PAGE = `<input type="file" id="many" multiple>
<input type="file" id="one">
<input type="file" id="hidden" style="display:none">
<button id="pick" onclick="document.getElementById('hidden').click()">Pick</button>
<script>
  window.seen = [];
  for (const input of document.querySelectorAll('input[type=file]')) {
    input.addEventListener('input', (event) => window.seen.push({ id: input.id, event: event.type, composed: event.composed }));
    input.addEventListener('change', async () => {
      const files = await Promise.all([...input.files].map(async (file) => ({ name: file.name, type: file.type, text: await file.text() })));
      window.seen.push({ id: input.id, event: 'change', files });
    });
  }
</script>`;

describe('uploads to a provider\'s browser', () => {
  let app: FixtureApp;
  let chrome: RemoteChrome;
  let engine: EngineHandle;
  let dir: string;

  beforeAll(async () => {
    app = await startFixtureApp();
    dir = mkdtempSync(path.join(tmpdir(), 'e2e-provider-uploads-'));
    writeFileSync(path.join(dir, 'notes.txt'), 'plain notes');
    writeFileSync(path.join(dir, 'data.json'), '{"ok":true}');
    mkdirSync(path.join(dir, 'folder'));
    writeFileSync(path.join(dir, 'folder', 'inside.txt'), 'inside');
    writeFileSync(path.join(dir, 'huge.bin'), '');
    truncateSync(path.join(dir, 'huge.bin'), 50 * 1024 * 1024 + 1);
    chrome = await launchRemoteChrome();
    const provider: BrowserProvider = {
      name: 'toy-remote',
      scope: 'worker',
      acquire: async () => ({ id: 'lease-1', cdpEndpoint: chrome.endpoint }),
      release: async () => undefined,
    };
    engine = webEngine({ browser: provider });
    const prepared = await engine.prepare!({ runId: 'run-uploads', targetName: 'web', projectRoot: dir, app: { site: new URL(app.url).hostname }, slots: 1, env: {}, signal: signal(), headed: false, log: () => undefined });
    await engine.init!({
      runId: 'run-uploads', targetName: 'web', projectRoot: dir,
      app: { site: new URL(app.url).hostname }, env: { ...prepared?.env }, headed: false,
      workerSlot: 0, signal: signal(), log: () => undefined,
    });
  });

  afterAll(async () => {
    await engine?.dispose!(cleanup());
    await engine?.finish!({ runId: 'run-uploads', targetName: 'web', env: {}, log: () => undefined, ...cleanup() });
    await closeRemoteChrome(chrome);
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await engine.endAttempt!(cleanup());
  });

  /** Starts an attempt on the recording page. */
  async function open(): Promise<void> {
    await engine.startAttempt!({ attemptId: 'a1', artifactsDir: mkdtempSync(path.join(dir, 'artifacts-')), signal: signal(), resolveSecret: noSecrets, ...ignoreTrace });
    await engine.session!.open!(`${app.url}/login`, operation());
    await browserFixture(engine, { baseUrl: app.url }).evaluate((html: string) => {
      document.body.innerHTML = html;
      for (const script of document.body.querySelectorAll('script')) {
        const live = document.createElement('script');
        live.textContent = script.textContent;
        script.replaceWith(live);
      }
      return null;
    }, PAGE);
  }

  /** Uploads `paths` through the node `selector` locates, and the error it failed with, if any. */
  async function upload(selector: string, paths: string[]): Promise<unknown> {
    const [node] = await engine.locate!(bySelector(selector), operation());
    return engine.perform!(node!.ref, { kind: 'setInputFiles', paths }, operation()).then(() => undefined, (error: unknown) => error);
  }

  const seen = () => browserFixture(engine, { baseUrl: app.url }).evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return (window as unknown as { seen: JsonValue[] }).seen;
  });

  it('sends the files\' bytes, names, and types, and fires input and change as a pick does', async () => {
    await open();
    expect(await upload('#many', ['notes.txt', path.join(dir, 'data.json')])).toBeUndefined();
    expect(await seen()).toEqual([
      { id: 'many', event: 'input', composed: true },
      { id: 'many', event: 'change', files: [{ name: 'notes.txt', type: 'text/plain', text: 'plain notes' }, { name: 'data.json', type: 'application/json', text: '{"ok":true}' }] },
    ]);
  });

  it('serves the input a button\'s file chooser opens', async () => {
    await open();
    expect(await upload('#pick', ['notes.txt'])).toBeUndefined();
    expect(await seen()).toEqual(expect.arrayContaining([
      { id: 'hidden', event: 'change', files: [{ name: 'notes.txt', type: 'text/plain', text: 'plain notes' }] },
    ]));
  });

  it('refuses two files for an input that takes one, a directory, and more bytes than it sends, and changes nothing', async () => {
    await open();
    expect(await upload('#one', ['notes.txt', 'data.json'])).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Non-multiple file input can only accept single file' });
    expect(await upload('#many', ['folder'])).toMatchObject({ code: 'UNSUPPORTED_CAPABILITY', message: expect.stringContaining('a directory cannot be sent') });
    expect(await upload('#many', ['huge.bin'])).toMatchObject({ code: 'UNSUPPORTED_CAPABILITY', message: expect.stringContaining('the limit is 52428800') });
    expect(await seen()).toEqual([]);
  });
});
