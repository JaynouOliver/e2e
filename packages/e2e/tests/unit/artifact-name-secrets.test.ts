/** The names a test gives its screenshots and recordings become file names, so they reach the engine redacted. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineEngine, type EngineHandle } from '@e2e-dev/core/lib/engine/index';
import { createEngineSession } from '@e2e-dev/core/lib/engine/session';
import { Deadline } from '@e2e-dev/core/lib/internal/time';
import { AttemptBudget } from '@e2e-dev/core/lib/run/budget';
import { createFixtures } from '@e2e-dev/core/lib/run/fixtures';
import { sessionLedger } from '@e2e-dev/core/lib/run/secrecy';
import { StepRecorder } from '@e2e-dev/core/lib/run/steps';
import { WorkerModels } from '@e2e-dev/core/lib/run/worker-models';
import { resolveConfig } from '../../src/config/resolve-run.ts';

const SECRET = 'hunter2-Abc123Xyz789';

function appOf(engine: EngineHandle, dir = '/tmp') {
  const config = resolveConfig(
    { targets: [{ name: 'fake', platform: 'custom', engine }], cache: 'off', secrets: { apiKey: SECRET } },
    { projectRoot: process.cwd(), env: {} },
  );
  const signal = new AbortController().signal;
  const session = createEngineSession({ engine, targetName: 'fake' });
  const steps = new StepRecorder('attempt', { redact: sessionLedger(session, config.allSecrets).redact });
  const { fixtures } = createFixtures({
    config, target: config.targets[0]!, session,
    steps, budget: new AttemptBudget(signal, new Deadline(10_000)), runId: 'run', attemptId: 'attempt',
    attempt: { testId: 'test', attemptId: 'attempt', titlePath: [], index: 0, signal, memory: new Map() },
    artifacts: { dir, register: () => 'artifact', link: () => 'artifact' }, priorSteps: () => steps.completed(),
    agentContext: undefined, saveSession: undefined,
    models: new WorkerModels(() => {}),
  });
  return { app: fixtures.app, steps };
}

describe('secrets in artifact names', () => {
  it('hands the engine a screenshot label with the secret replaced', async () => {
    const screenshot = vi.fn(async (_label: string | undefined) => 'screenshots/001.png');
    const { app, steps } = appOf(defineEngine({ name: 'fake', version: '1', spiVersion: 1, artifacts: { screenshot } }));

    await app.screenshot(`signed-in-${SECRET}`);
    await app.screenshot('plain');
    await app.screenshot();

    expect(screenshot.mock.calls.map(([label]) => label)).toEqual(['signed-in-<secret:apiKey>', 'plain', undefined]);
    expect(steps.all()[0]).toMatchObject({ api: 'app.screenshot', label: 'signed-in-<secret:apiKey>' });
  });

  describe('recordings', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-artifact-names-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('names a recording file with the secret replaced', async () => {
      const stopVideo = async () => {
        mkdirSync(path.join(dir, 'video'), { recursive: true });
        writeFileSync(path.join(dir, 'video', 'video.webm'), 'frames');
        return [{ path: 'video/video.webm', startedAt: '2026-10-27T10:00:00.000Z' }];
      };
      const engine = defineEngine({
        name: 'fake', version: '1', spiVersion: 1,
        artifacts: { screenshot: async () => 'screenshots/001.png', startVideo: async () => {}, stopVideo },
      });
      const { app } = appOf(engine, dir);

      await app.startRecording({ name: `flow-${SECRET}` });
      const videos = await app.stopRecording();

      expect(videos).toEqual([{ path: path.join(dir, 'recordings', '001-flow-_secret_apiKey_.webm'), startedAt: '2026-10-27T10:00:00.000Z' }]);
    });

    it('still refuses a name that is not a string', async () => {
      const engine = defineEngine({
        name: 'fake', version: '1', spiVersion: 1,
        artifacts: { screenshot: async () => 'screenshots/001.png', startVideo: async () => {}, stopVideo: async () => [] },
      });
      const { app } = appOf(engine, dir);

      await expect(app.startRecording({ name: 7 as unknown as string })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });
});
