/**
 * The browser-wide events of one BiDi session routed to the running attempt:
 * which user context each browsing context belongs to, the tabs the app
 * opens and closes, user prompts for its dialog router, and the console,
 * errors, and failed requests of its app log.
 */

import type { Script } from 'webdriver-bidi-protocol';
import type { AppLogEntry } from '@e2e-dev/core/engine';
import type { NativeDialog } from './dialogs.ts';
import type { ContextTree } from './context-tree.ts';
import type { BidiSession } from './session.ts';
import type { BidiConnection } from './connection.ts';
import { callFunction } from './script.ts';

/** The events every session subscribes to for as long as the browser runs. */
export const SESSION_EVENTS = [
  'log.entryAdded',
  'network.responseStarted',
  'network.responseCompleted',
  'network.fetchError',
  'browsingContext.contextCreated',
  'browsingContext.contextDestroyed',
  'browsingContext.navigationStarted',
  'browsingContext.navigationCommitted',
  'browsingContext.navigationFailed',
  'browsingContext.domContentLoaded',
  'browsingContext.fragmentNavigated',
  'browsingContext.historyUpdated',
  'browsingContext.userPromptOpened',
  'browsingContext.downloadWillBegin',
  'browsingContext.downloadEnd',
  'input.fileDialogOpened',
] as const;

/** Documents that are no place the app went: a fresh tab, an inline frame. */
const NO_PLACE = new Set(['about:blank', 'about:srcdoc']);

/** Chromium's and Firefox's codes for a request the page itself abandoned, which is no app failure. */
const ABORTED = new Set(['net::ERR_ABORTED', 'NS_BINDING_ABORTED']);

/**
 * Routes `connection`'s events to the attempt `current` returns; returns the
 * unsubscribe. A prompt in a context of another session (a browser shared
 * over CDP) is left for that session to answer. A tab the app opens joins
 * the attempt's tabs once a document loads in it, and a tab that closes
 * leaves them. Where the app went is told to the app log: the shown tab's
 * own navigations, the tabs the app opens, where a background tab went, and
 * the frames it loads, never the driver's. Every origin a document starts or
 * lands at (after a redirect) is visited, for its permissions and a saved
 * session's storage.
 */
export function routeEvents(connection: BidiConnection, contexts: ContextTree, current: () => BidiSession | undefined): () => void {
  const report = (entry: AppLogEntry): void => {
    try {
      current()?.attempt.appLog(entry);
    } catch {
      return;
    }
  };
  const ours = (context: string | null | undefined): BidiSession | undefined => {
    const session = current();
    return session?.owns(context) === true ? session : undefined;
  };
  /** Each attempt's lines still waiting on an earlier one, so the trace reads them in the order they happened. */
  const queued = new WeakMap<BidiSession, Promise<void>>();
  const send = (session: BidiSession, line: string): void => {
    if (session.lifetime.aborted) return;
    try {
      session.attempt.navigation(line);
    } catch {
      return;
    }
  };
  /**
   * Tells `session`'s trace where the app went, in event order: a line whose
   * text is still being read (`line` a promise) holds its place, and the
   * lines after it wait for it. Only the attempt the event belonged to hears
   * it, never one that started since.
   */
  const went = (session: BidiSession, line: string | Promise<string>): void => {
    const before = queued.get(session);
    if (before === undefined && typeof line === 'string') {
      send(session, line);
      return;
    }
    const next = (before ?? Promise.resolve()).then(async () => send(session, await line));
    queued.set(session, next);
    void next.finally(() => {
      if (queued.get(session) === next) queued.delete(session);
    });
  };
  /** The navigation whose document joined each tab the app opened, which the opening already told. */
  const joinedBy = new Map<string, string>();
  const navigated = (event: { readonly context: string; readonly url: string; readonly navigation?: string | null }): void => {
    const session = ours(event.context);
    if (session === undefined || NO_PLACE.has(event.url) || event.url.startsWith('data:')) return;
    void session.visit(event.url).catch((cause: unknown) => session.latch.latch(asError(cause)));
    if (contexts.top(event.context) !== event.context) {
      went(session, frameName(connection, event.context).then((name) => `frame${name === '' ? '' : ` "${name}"`} loaded ${event.url}`));
      return;
    }
    // A tab yet to join (its opening tells its first document) or no tab at all (a saved-state scratch tab).
    if (session.tabs.find(event.context) === undefined) return;
    if (event.navigation != null && joinedBy.get(event.context) === event.navigation) return;
    if (event.context !== session.context) went(session, `a background tab navigated to ${event.url}`);
    else if (session.ownNavigations === 0) went(session, `navigated to ${event.url}`);
  };
  const offs = [
    connection.on('browsingContext.contextCreated', (info) => {
      contexts.created(info.context, info.userContext, info.parent);
      const session = ours(info.context);
      if (info.parent != null || info.originalOpener == null || session === undefined) return;
      void session.network.addContext(info.context).catch((cause: unknown) => session.latch.latch(asError(cause)));
      session.tabs.appOpened(info.context, info.originalOpener);
    }),
    connection.on('browsingContext.contextDestroyed', (info) => {
      const session = ours(info.context);
      if (session !== undefined && contexts.top(info.context) !== info.context) {
        session.network.retire(info.context);
      } else if (session !== undefined) {
        session.contextClosed(info.context);
        void session.network.removeContext(info.context).catch((cause: unknown) => session.latch.latch(asError(cause)));
      }
      joinedBy.delete(info.context);
      contexts.destroyed(info.context);
    }),
    connection.on('browsingContext.navigationStarted', (event) => {
      const session = ours(event.context);
      if (session === undefined) return;
      void session.visit(event.url).catch((cause: unknown) => session.latch.latch(asError(cause)));
      session.tabs.navigationStarted(event.context, event.url);
    }),
    connection.on('browsingContext.navigationFailed', (event) => {
      ours(event.context)?.tabs.navigationFailed(event.context);
    }),
    connection.on('browsingContext.domContentLoaded', (event) => {
      const session = ours(event.context);
      if (session?.tabs.loaded(event.context, event.url) === undefined) return;
      if (event.navigation != null) joinedBy.set(event.context, event.navigation);
      went(session, `the app opened a new tab${NO_PLACE.has(event.url) ? '' : ` at ${event.url}`}`);
    }),
    connection.on('browsingContext.navigationCommitted', navigated),
    connection.on('browsingContext.fragmentNavigated', navigated),
    connection.on('browsingContext.historyUpdated', navigated),
    connection.on('browsingContext.userPromptOpened', (prompt) => {
      const session = ours(prompt.context);
      if (session === undefined) return;
      const answer = async (accept: boolean, userText?: string): Promise<void> => {
        await connection.send('browsingContext.handleUserPrompt', { context: prompt.context, accept, ...(userText === undefined ? {} : { userText }) });
      };
      const dialog: NativeDialog = {
        type: () => prompt.type,
        message: () => prompt.message,
        accept: (text) => answer(true, text),
        dismiss: () => answer(false),
      };
      void session.dialogs.dispatch(dialog);
    }),
    connection.on('log.entryAdded', (entry) => {
      if (ours(entry.source.context) === undefined || entry.text === null) return;
      if (entry.type === 'javascript') report({ source: 'error', level: 'error', text: entry.text });
      else if (entry.level !== 'debug' && !entry.text.startsWith('Failed to load resource:')) {
        report({ source: 'console', level: entry.level === 'warn' ? 'warning' : entry.level, text: consoleText(entry.text, entry.stackTrace) });
      }
    }),
    connection.on('network.responseCompleted', (event) => {
      const { status, statusText } = event.response;
      if (ours(event.context) === undefined || status < 400 || isMissingFavicon(event.request.url, status)) return;
      report({ source: 'network', level: status >= 500 ? 'error' : 'warning', text: `${event.request.method} ${event.request.url} ${status}${statusText === '' ? '' : ` ${statusText}`}` });
    }),
    connection.on('network.fetchError', (event) => {
      if (ours(event.context) === undefined || ABORTED.has(event.errorText)) return;
      report({ source: 'network', level: 'error', text: `${event.request.method} ${event.request.url} ${event.errorText}` });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** The frame's name (`window.name`, its iframe's `name` until the frame renames itself), as Playwright's `frame.name()` reads it; empty for a frame gone before it was read. */
async function frameName(connection: BidiConnection, context: string): Promise<string> {
  try {
    const name = await callFunction(connection, context, () => window.name);
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

/** `message (at /app.js:12)`: the text, and the frame that logged it when the browser says, its line counted from one. */
function consoleText(text: string, stackTrace: Script.StackTrace | undefined): string {
  const frame = stackTrace?.callFrames[0];
  return frame === undefined || frame.url === '' ? text : `${text} (at ${frame.url}:${frame.lineNumber + 1})`;
}

/** A browser's own request for a site icon the app never served, which the app log leaves out. */
function isMissingFavicon(url: string, status: number): boolean {
  return status === 404 && URL.canParse(url) && new URL(url).pathname === '/favicon.ico';
}

/** A thrown value as an Error, for the latch. */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
