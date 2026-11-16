/** Held keyboard input through the actual browser fixture and native DOM events. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser } from '../../src/fixture/types.ts';
import { onFirefox, startWebSession, type WebSession } from '../helpers/web-session.ts';
describe('held keyboard input', () => {
  let session: WebSession;
  let browser: Browser;
  beforeAll(async () => {
    session = await startWebSession({ timeoutMs: 5_000, startAttempt: false });
  });
  beforeEach(async () => {
    await session.startAttempt();
    await session.setContent('<h1 id="events"></h1>');
    browser = session.browser;
    await browser.evaluate(() => {
      for (const type of ['keydown', 'keyup']) document.addEventListener(type, event => {
        if (!(event instanceof KeyboardEvent)) return;
        const output = document.querySelector('#events');
        if (output !== null) output.textContent += `${event.type}|${event.key}|${event.shiftKey}|${event.repeat};`;
      });
      return null;
    });
  });
  afterEach(async () => { await session.endAttempt(); });
  afterAll(async () => { await session.close(); });
  it('keeps a modifier held across another key and releases it for later input', async () => {
    await browser.keyboard.down('Shift');
    await browser.keyboard.press('KeyB');
    await browser.keyboard.up('Shift');
    await browser.keyboard.press('KeyB');
    const events = await browser.evaluate(() => document.querySelector('#events')?.textContent ?? '');
    expect(events).toContain('keydown|B|true|false;');
    expect(events).toContain('keyup|Shift|false|false;');
    expect(events).toContain('keydown|b|false|false;');
  });
  it('presses a media key over CDP on Chromium, refuses it on Firefox, and presses NumpadDecimal with NumLock off', async () => {
    await browser.keyboard.press('Shift');
    // WebDriver defines no key value for MediaPlayPause; only Chromium presses it, over CDP.
    const media = browser.keyboard.press('MediaPlayPause');
    if (onFirefox) await expect(media).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY', message: expect.stringContaining('WebDriver defines no key value for "MediaPlayPause"') });
    else await media;
    await browser.keyboard.press('NumpadDecimal');
    const events = await browser.evaluate(() => document.querySelector('#events')?.textContent ?? '');
    const mediaEvents = onFirefox ? '' : 'keydown|MediaPlayPause|false|false;keyup|MediaPlayPause|false|false;';
    expect(events).toBe(`keydown|Shift|true|false;keyup|Shift|false|false;${mediaEvents}keydown|Delete|false|false;keyup|Delete|false|false;`);
  });
  it.runIf(process.platform === 'darwin')('runs the macOS editing command of a shortcut, with a modifier held by keyboard.down', async () => {
    await session.setContent('<div contenteditable>one two</div>');
    await browser.evaluate(() => { document.querySelector<HTMLElement>('div')?.focus(); return null; });
    await browser.keyboard.press('Meta+ArrowRight');
    await browser.keyboard.down('Shift');
    await browser.keyboard.press('Alt+ArrowLeft');
    await browser.keyboard.up('Shift');
    expect(await browser.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('two');
  });
  it('marks a second down as repeat and a later release ends the held sequence', async () => {
    await browser.keyboard.down('a');
    await browser.keyboard.down('a');
    await browser.keyboard.up('a');
    await browser.keyboard.down('a');
    await browser.keyboard.up('a');
    const events = await browser.evaluate(() => document.querySelector('#events')?.textContent ?? '');
    expect(events).toBe('keydown|a|false|false;keydown|a|false|true;keyup|a|false|false;keydown|a|false|false;keyup|a|false|false;');
  });
});
