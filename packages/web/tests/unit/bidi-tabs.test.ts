/**
 * The attempt's tabs on their own: which tab the app opened joins, where the
 * screen goes when the shown tab closes, and what the agent's index-based
 * verbs refuse.
 */

import { describe, expect, it } from 'vitest';
import { AttemptTabs } from '../../src/driver/tabs.ts';

/** Tabs over a host that records what it was asked to show, record, and close. */
function tabsOn() {
  let shown: string | undefined;
  const recorded: { context: string | undefined; closed: boolean }[] = [];
  const closed: string[] = [];
  const tabs: AttemptTabs = new AttemptTabs({
    shown: () => shown,
    prepare: async () => undefined,
    publish: (context) => { shown = context; },
    record: async (context, wasClosed) => void recorded.push({ context, closed: wasClosed }),
    close: async (context) => {
      closed.push(context);
      tabs.destroyed(context);
    },
  });
  shown = tabs.own('own', true).context;
  return { tabs, shown: () => shown, recorded, closed };
}

describe('AttemptTabs', () => {
  it('joins a tab the app opened with its first document, never with the blank one a failed navigation left', () => {
    const { tabs } = tabsOn();
    tabs.appOpened('download', 'own');
    tabs.navigationStarted('download', 'http://app.test/export.csv');
    tabs.navigationFailed('download');
    expect(tabs.loaded('download', 'about:blank')).toBeUndefined();
    tabs.appOpened('written', 'own');
    expect(tabs.loaded('written', 'about:blank')?.opener?.context).toBe('own');
    tabs.appOpened('help', 'own');
    tabs.navigationStarted('help', 'http://app.test/help');
    expect(tabs.loaded('help', 'http://app.test/help')).toBeDefined();
    expect(tabs.list().map((tab) => tab.context)).toEqual(['own', 'written', 'help']);
    expect(tabs.describe(tabs.active())).toEqual({ count: 3, active: 0 });
  });

  it('shows the nearest open opener when the shown tab closes, else the tab shown most recently', async () => {
    const { tabs, shown, recorded } = tabsOn();
    tabs.appOpened('middle', 'own');
    const middle = tabs.loaded('middle', 'http://app.test/middle')!;
    tabs.appOpened('last', 'middle');
    const last = tabs.loaded('last', 'http://app.test/last')!;
    await tabs.show(middle);
    await tabs.show(last);
    tabs.destroyed('middle');
    expect(shown()).toBe('last');
    tabs.destroyed('last');
    expect(shown()).toBe('own');
    await tabs.settled();
    expect(recorded.at(-1)).toEqual({ context: 'own', closed: true });
    await expect(tabs.show(middle)).rejects.toMatchObject({ code: 'ACTION_FAILED', message: 'the tab is closed' });
  });

  it('refuses an index no tab is at, and closing the last open tab, as ACTION_FAILED', async () => {
    const { tabs, closed } = tabsOn();
    await expect(tabs.showAt(1)).rejects.toMatchObject({ code: 'ACTION_FAILED', message: 'there is no tab 2: 1 tab is open' });
    await expect(tabs.closeAt(0)).rejects.toMatchObject({ code: 'ACTION_FAILED', message: 'tab 1 is the only open tab' });
    tabs.appOpened('popup', 'own');
    tabs.loaded('popup', 'http://app.test/popup');
    const both = await Promise.allSettled([tabs.closeAt(1), tabs.closeAt(0)]);
    expect(both.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(closed).toEqual(['popup']);
  });

  it('shows the next tab the app opens to a popup wait, and names the page one is still loading', async () => {
    const { tabs, shown } = tabsOn();
    const popup = tabs.nextPopup();
    tabs.appOpened('slow', 'own');
    tabs.navigationStarted('slow', 'http://app.test/slow');
    expect(popup.loading()).toBe('http://app.test/slow');
    tabs.loaded('slow', 'http://app.test/slow');
    expect((await popup.opened).context).toBe('slow');
    expect(shown()).toBe('slow');
    popup.cancel();
  });
});
