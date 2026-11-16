/**
 * The attempt's top-level tabs, in the order they opened: its own tab, the
 * tabs a test opened (`browser.newTab`), and the tabs the app opened from
 * one of them. The shown tab is the one the session's `context` names;
 * observation, actions, input, and every page-scoped wait follow it.
 *
 * A tab the app opens (`window.open`, a `target="_blank"` link) joins once
 * a document loads in it, and stays in the background unless
 * `browser.waitForPopup` waits for it. A tab whose only navigation went
 * elsewhere (a download, a `204`, a `mailto:` link) never gets a document,
 * so it never joins. When the shown tab closes, the tab that opened it is
 * shown next, else the open tab shown most recently.
 */

import { TestError, type EngineTabs } from '@e2e-dev/core/engine';

/** One tab of the attempt. The same tab is the same object for the whole attempt. */
export interface AttemptTab {
  /** Its top-level browsing context. */
  readonly context: string;
  /** The tab it was opened from; undefined for the attempt's own tab and one a test opened. */
  readonly opener: AttemptTab | undefined;
  /** When it was last shown, in the attempt's order; 0 for never. */
  shownAt: number;
  /** Whether it has closed. */
  closed: boolean;
}

/** What the tabs ask of the session that shows them. */
export interface TabHost {
  /** The context shown now. */
  shown(): string | undefined;
  /** Sets up `context` to be shown: the attempt's viewport, and the browser's focus. */
  prepare(context: string): Promise<void>;
  /** Makes `context` the shown one at once, or none; every ref and frame of the one shown before is forgotten. */
  publish(context: string | undefined): void;
  /** Moves the recording to `context`, ending the one before; `closed` when that one closed on its own. */
  record(context: string | undefined, closed: boolean): Promise<void>;
  /** Asks the browser to close `context`. */
  close(context: string): Promise<void>;
}

/** A tab the app opened that has no document yet. */
interface Unjoined {
  readonly opener: AttemptTab | undefined;
  /** Whether a navigation to a document other than the blank one started in it. */
  started: boolean;
  /** The URL of the navigation it is loading, until that one fails. */
  loading: string | undefined;
}

/** A `browser.waitForPopup` waiting for the next tab the app opens, told the tab and the change that shows it. */
type PopupWaiter = (tab: AttemptTab, shown: Promise<void>) => void;

/** The attempt's tabs and the changes between them, in the order they happen. */
export class AttemptTabs {
  private open: AttemptTab[] = [];
  private readonly unjoined = new Map<string, Unjoined>();
  /** How many times a tab was shown, for `AttemptTab.shownAt`. */
  private shown = 0;
  /**
   * Tab changes in the order they happened: showing a tab, returning from
   * one that closed. Settles once the last has finished; never rejects.
   */
  private work: Promise<void> = Promise.resolve();
  private readonly waiters = new Set<PopupWaiter>();
  /** Closes being awaited, each resolved once its tab is gone from the tabs. */
  private readonly closes = new Map<AttemptTab, () => void>();

  constructor(private readonly host: TabHost) {}

  /** The open tabs, in the order they opened. */
  list(): readonly AttemptTab[] {
    return this.open;
  }

  /** The open tab of `context`, if it is one. */
  find(context: string | null | undefined): AttemptTab | undefined {
    return context == null ? undefined : this.open.find((tab) => tab.context === context);
  }

  /** The tab shown now, if any. */
  active(): AttemptTab | undefined {
    return this.find(this.host.shown());
  }

  /** Where `tab` stands among the open tabs, for a snapshot read from it; undefined while it is the only one, or once it closed. */
  describe(tab: AttemptTab | undefined): EngineTabs | undefined {
    const active = tab === undefined ? -1 : this.open.indexOf(tab);
    return this.open.length < 2 || active === -1 ? undefined : { count: this.open.length, active };
  }

  /** Settles once every tab change queued so far has finished. */
  settled(): Promise<void> {
    return this.work;
  }

  /** Records a tab the attempt opened itself (its own tab, `browser.newTab`). */
  own(context: string, shown: boolean): AttemptTab {
    const tab: AttemptTab = { context, opener: undefined, shownAt: shown ? ++this.shown : 0, closed: false };
    this.open.push(tab);
    return tab;
  }

  /** The app opened `context` from `opener`: it joins once a document loads in it. */
  appOpened(context: string, opener: string | null | undefined): void {
    this.unjoined.set(context, { opener: this.find(opener), started: false, loading: undefined });
  }

  /** A navigation started in a top-level context. */
  navigationStarted(context: string, url: string): void {
    const pending = this.unjoined.get(context);
    if (pending === undefined || url === 'about:blank') return;
    pending.started = true;
    pending.loading = url;
  }

  /** A navigation failed in a top-level context: the tab is no longer loading it. */
  navigationFailed(context: string): void {
    const pending = this.unjoined.get(context);
    if (pending !== undefined) pending.loading = undefined;
  }

  /**
   * A document loaded in a top-level context. A tab the app opened joins
   * with its first document: one it navigated to, or the blank one when
   * nothing else started in it, as a tab the app writes itself. The blank
   * document a failed navigation leaves behind is none. Returns the tab when
   * this joined it.
   */
  loaded(context: string, url: string): AttemptTab | undefined {
    const pending = this.unjoined.get(context);
    if (pending === undefined || (url === 'about:blank' && pending.started)) return undefined;
    this.unjoined.delete(context);
    const tab: AttemptTab = { context, opener: pending.opener, shownAt: 0, closed: false };
    this.open.push(tab);
    if (this.waiters.size > 0) {
      const shown = this.inTurn(() => this.reveal(tab));
      for (const waiter of this.waiters) waiter(tab, shown);
    }
    return tab;
  }

  /**
   * A top-level context closed. When it was the shown tab, its nearest open
   * opener is shown next, else the open tab shown most recently, at once;
   * the recording follows in turn. Returns whether it was one of the tabs.
   */
  destroyed(context: string): boolean {
    this.unjoined.delete(context);
    const tab = this.find(context);
    if (tab === undefined) return false;
    tab.closed = true;
    this.open.splice(this.open.indexOf(tab), 1);
    this.closes.get(tab)?.();
    this.closes.delete(tab);
    if (this.host.shown() !== context) return true;
    const next = this.returnTo(tab);
    this.host.publish(next?.context);
    if (next !== undefined) next.shownAt = ++this.shown;
    void this.inTurn(async () => {
      if (next !== undefined && this.host.shown() === next.context) await this.host.prepare(next.context);
      await this.host.record(next !== undefined && this.host.shown() === next.context ? next.context : undefined, true);
    });
    return true;
  }

  /** Forgets every tab, as a restart or a new user context closes them all. */
  clear(): void {
    for (const tab of this.open) tab.closed = true;
    this.open = [];
    this.unjoined.clear();
    for (const resolve of this.closes.values()) resolve();
    this.closes.clear();
  }

  /** Shows one open tab: every read and action from now on is on it. `ACTION_FAILED` once it closed. */
  async show(tab: AttemptTab): Promise<void> {
    const open = (): void => {
      if (tab.closed) throw new TestError('ACTION_FAILED', 'the tab is closed');
    };
    open();
    // Checked again in turn: a change queued before this one may be the tab closing.
    await this.inTurn(async () => {
      open();
      await this.reveal(tab);
    }, true);
  }

  /** Shows the open tab at `index` in opening order, as the agent's `switchTab` counts them. */
  async showAt(index: number): Promise<void> {
    await this.show(this.at(index));
  }

  /**
   * Closes one tab and waits until it is gone and the tab shown next is
   * shown. With `keepLast`, naming the tab, the last open tab stays:
   * closing it is `ACTION_FAILED`.
   */
  async close(tab: AttemptTab, keepLast?: string): Promise<void> {
    const refused = (): boolean => keepLast !== undefined && this.open.every((other) => other === tab);
    const refusal = (): TestError => new TestError('ACTION_FAILED', `${keepLast ?? 'the tab'} is the only open tab`);
    if (!tab.closed && refused()) throw refusal();
    // Checked again in turn: a change queued before this one may be another tab closing.
    await this.inTurn(async () => {
      if (tab.closed) return;
      if (refused()) throw refusal();
      const gone = new Promise<void>((resolve) => this.closes.set(tab, resolve));
      try {
        await this.host.close(tab.context);
      } catch (cause) {
        this.closes.delete(tab);
        if (tab.closed) return;
        throw cause;
      }
      await gone;
    }, true);
    await this.settled();
  }

  /** Closes the open tab at `index` in opening order, as the agent's `closeTab` counts them; the last open tab stays. */
  async closeAt(index: number): Promise<void> {
    await this.close(this.at(index), `tab ${String(index + 1)}`);
  }

  /**
   * Waits for the next tab the app opens: `opened` resolves with it once it
   * is shown, or with it closed when it closed first. `loading` names the
   * page a tab the app opened is still loading, for a wait that times out.
   * `cancel` stops waiting.
   */
  nextPopup(): { readonly opened: Promise<AttemptTab>; loading(): string | undefined; cancel(): void } {
    let waiter!: PopupWaiter;
    const opened = new Promise<AttemptTab>((resolve) => {
      waiter = (tab, shown) => {
        this.waiters.delete(waiter);
        resolve(shown.then(() => tab));
      };
    });
    this.waiters.add(waiter);
    return {
      opened,
      loading: () => [...this.unjoined.values()].findLast((pending) => pending.loading !== undefined)?.loading,
      cancel: () => {
        this.waiters.delete(waiter);
      },
    };
  }

  /** The open tab at `index` in opening order, or an `ACTION_FAILED` the model reads. */
  private at(index: number): AttemptTab {
    const tab = Number.isSafeInteger(index) ? this.open[index] : undefined;
    if (tab === undefined) {
      const count = this.open.length;
      throw new TestError('ACTION_FAILED', `there is no tab ${String(index + 1)}: ${String(count)} tab${count === 1 ? ' is' : 's are'} open`);
    }
    return tab;
  }

  /** Shows `tab` once it is set up, then moves the recording to it; a tab that closed meanwhile is left alone. */
  private async reveal(tab: AttemptTab): Promise<void> {
    if (this.host.shown() === tab.context) return;
    await this.host.prepare(tab.context);
    if (tab.closed) return;
    this.host.publish(tab.context);
    tab.shownAt = ++this.shown;
    await this.host.record(tab.context, false);
  }

  /** The tab shown when `closed` closes: its nearest open opener, else the open tab shown most recently. */
  private returnTo(closed: AttemptTab): AttemptTab | undefined {
    for (let opener = closed.opener; opener !== undefined; opener = opener.opener) {
      if (!opener.closed) return opener;
    }
    return this.open.reduce<AttemptTab | undefined>((best, tab) => (best === undefined || tab.shownAt > best.shownAt ? tab : best), undefined);
  }

  /**
   * Queues one tab change behind the earlier ones. The queue never rejects;
   * `rethrow` hands this change's own failure to its caller, and a change
   * nobody awaits fails quietly, as a tab the app opened cannot fail a step.
   */
  private inTurn(work: () => Promise<void>, rethrow = false): Promise<void> {
    const run = this.work.then(work);
    this.work = run.catch(() => undefined);
    return rethrow ? run : run.catch(() => undefined);
  }
}
