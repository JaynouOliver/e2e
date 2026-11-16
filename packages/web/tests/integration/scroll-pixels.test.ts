/** A node scrolled into view paints where its box says, so a screenshot cut to the box holds the node and nothing else. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodePng } from '@e2e-dev/core/lib/internal/image';
import { startWebSession, type WebSession } from '../helpers/web-session.ts';

const GREEN = '<div id="far" style="margin-top:1600px;width:64px;height:24px;background:#16a34a"></div>';

describe('scrolling into view', () => {
  let page: WebSession;
  beforeAll(async () => {
    page = await startWebSession();
  });
  afterAll(async () => {
    await page?.close();
  });

  /** The first screenshot row the green block paints and how many it paints, beside the row its box rounds to and its height. */
  async function rows(): Promise<{ painted: [number, number]; box: [number, number] }> {
    await page.browser.locator('#far').scrollIntoView();
    const box = (await page.browser.locator('#far').boundingBox())!;
    const shot = decodePng((await page.observe({ pixels: true })).pixels!.data);
    const green = Array.from({ length: shot.height }, (_, y) => y).filter((y) => shot.data[(y * shot.width + box.x + 2) * 4 + 1] === 163);
    return { painted: [green[0]!, green.length], box: [Math.round(box.y), 24] };
  }

  it('lands on a whole pixel when the node sits at a fractional offset, at the end of the page too', async () => {
    for (const after of ['', '<div style="height:2000px"></div>']) {
      await page.setContent(`<h1>Swatches</h1><div style="display:flex;padding:8px"><div style="width:40px;height:40px"></div></div><iframe style="height:80px;border:0"></iframe>${GREEN}${after}`);
      const { painted, box } = await rows();
      expect(painted).toEqual(box);
    }
  });

});
