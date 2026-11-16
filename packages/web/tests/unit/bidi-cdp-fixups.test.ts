/**
 * The CDP fixups in front of the chromium-bidi mapper: a redirect hop's
 * request-stage pause reaches the mapper after the hop's
 * `Network.requestWillBeSent`, whichever Chrome sent first, and a site
 * icon's pauses, whose events the mapper drops, are answered instead.
 */

import { describe, expect, it } from 'vitest';
import { cdpFixups } from '../../src/driver/cdp-fixups.ts';

const willBeSent = (requestId: string, sessionId = 's'): string => JSON.stringify({ method: 'Network.requestWillBeSent', sessionId, params: { requestId } });
const paused = (networkId: string, sessionId = 's', extra: Record<string, unknown> = {}): string => JSON.stringify({ method: 'Fetch.requestPaused', sessionId, params: { requestId: `fetch-${networkId}`, networkId, ...extra } });
const finished = (requestId: string, sessionId = 's'): string => JSON.stringify({ method: 'Network.loadingFinished', sessionId, params: { requestId } });

/** Runs `messages` through the fixups and returns what the mapper received, in order, and what was sent to the browser. */
function fix(messages: string[]): { delivered: string[]; sent: unknown[] } {
  const delivered: string[] = [];
  const sent: unknown[] = [];
  const handle = cdpFixups((message) => delivered.push(message), (message) => sent.push(JSON.parse(message)));
  for (const message of messages) handle(message);
  return { delivered, sent };
}

/** What the mapper received of `messages`, in order. */
const reorder = (messages: string[]): string[] => fix(messages).delivered;

const redirected = (requestId: string, sessionId = 's'): string => JSON.stringify({ method: 'Network.requestWillBeSent', sessionId, params: { requestId, redirectResponse: { status: 302 } } });
const responseInfo = (requestId: string, statusCode: number, sessionId = 's'): string => JSON.stringify({ method: 'Network.responseReceivedExtraInfo', sessionId, params: { requestId, statusCode } });
const received = (requestId: string, sessionId = 's'): string => JSON.stringify({ method: 'Network.responseReceived', sessionId, params: { requestId, response: { status: 200 } } });

describe('cdpFixups response ExtraInfo', () => {
  it('passes the usual redirect order through', () => {
    const messages = [willBeSent('r'), responseInfo('r', 302), redirected('r'), responseInfo('r', 200), received('r'), finished('r')];
    expect(reorder(messages)).toEqual(messages);
  });

  it('holds the next hop\'s response ExtraInfo that arrives before the redirect until the redirect is sent', () => {
    expect(reorder([willBeSent('r'), responseInfo('r', 302), responseInfo('r', 200), redirected('r'), received('r'), finished('r')]))
      .toEqual([willBeSent('r'), responseInfo('r', 302), redirected('r'), responseInfo('r', 200), received('r'), finished('r')]);
  });

  it('keeps a redirect\'s late ExtraInfo and the next hop\'s in the order Chrome sent them', () => {
    const messages = [willBeSent('r'), redirected('r'), responseInfo('r', 302), responseInfo('r', 200), received('r'), finished('r')];
    expect(reorder(messages)).toEqual(messages);
  });

  it('keeps a hop answered twice without a redirect, as an auth retry is, in order before its response', () => {
    const messages = [willBeSent('r'), responseInfo('r', 401), responseInfo('r', 200), received('r'), finished('r')];
    expect(reorder(messages)).toEqual(messages);
  });
});

describe('cdpFixups', () => {
  it('passes the usual order through', () => {
    const messages = [willBeSent('r'), paused('r'), willBeSent('r'), paused('r'), finished('r')];
    expect(reorder(messages)).toEqual(messages);
  });

  it('lets a first hop\'s early pause through, which the mapper handles', () => {
    const messages = [paused('r'), willBeSent('r')];
    expect(reorder(messages)).toEqual(messages);
  });

  it('holds a redirect hop\'s early pause until the hop is sent', () => {
    const extra = JSON.stringify({ method: 'Network.requestWillBeSentExtraInfo', sessionId: 's', params: { requestId: 'r' } });
    expect(reorder([willBeSent('r'), paused('r'), paused('r'), extra, willBeSent('r')]))
      .toEqual([willBeSent('r'), paused('r'), extra, willBeSent('r'), paused('r')]);
  });

  it('never holds a response-stage pause', () => {
    const response = paused('r', 's', { responseStatusCode: 302 });
    expect(reorder([willBeSent('r'), paused('r'), response])).toEqual([willBeSent('r'), paused('r'), response]);
  });

  it('keeps each session\'s request ids apart', () => {
    expect(reorder([willBeSent('r', 'a'), paused('r', 'a'), paused('r', 'b')]))
      .toEqual([willBeSent('r', 'a'), paused('r', 'a'), paused('r', 'b')]);
  });

  it('hands a held pause on when its request ends without another hop', () => {
    expect(reorder([willBeSent('r'), paused('r'), paused('r'), finished('r')]))
      .toEqual([willBeSent('r'), paused('r'), finished('r'), paused('r')]);
  });

  it('continues a site icon\'s request-stage pause itself and never hands it to the mapper', () => {
    const icon = (networkId: string, url: string): string => JSON.stringify({ method: 'Fetch.requestPaused', sessionId: 's', params: { requestId: `fetch-${networkId}`, networkId, request: { url } } });
    const page = icon('p', 'http://app.test/favicon.ico?v=1');
    const { delivered, sent } = fix([willBeSent('i'), icon('i', 'http://app.test/assets/favicon.ico'), willBeSent('p'), page]);
    expect(delivered).toEqual([willBeSent('i'), willBeSent('p'), page]);
    expect(sent).toEqual([{ id: 2_000_000_000, method: 'Fetch.continueRequest', params: { requestId: 'fetch-i' }, sessionId: 's' }]);
  });

  it('continues a site icon\'s early redirect-hop pause once its hop is sent', () => {
    const icon = JSON.stringify({ method: 'Fetch.requestPaused', sessionId: 's', params: { requestId: 'fetch-r', networkId: 'r', request: { url: 'http://app.test/favicon.ico' } } });
    const { delivered, sent } = fix([willBeSent('r'), paused('r'), icon]);
    expect(delivered).toEqual([willBeSent('r'), paused('r')]);
    expect(sent).toEqual([]);
    const after = fix([willBeSent('r'), paused('r'), icon, willBeSent('r')]);
    expect(after.sent).toEqual([{ id: 2_000_000_000, method: 'Fetch.continueRequest', params: { requestId: 'fetch-r' }, sessionId: 's' }]);
  });

  it('answers a site icon\'s auth challenge with the browser\'s default', () => {
    const challenge = JSON.stringify({ method: 'Fetch.authRequired', sessionId: 's', params: { requestId: 'fetch-i', request: { url: 'http://app.test/favicon.ico' } } });
    const other = JSON.stringify({ method: 'Fetch.authRequired', sessionId: 's', params: { requestId: 'fetch-o', request: { url: 'http://app.test/private' } } });
    const { delivered, sent } = fix([challenge, other]);
    expect(delivered).toEqual([other]);
    expect(sent).toEqual([{ id: 2_000_000_000, method: 'Fetch.continueWithAuth', params: { requestId: 'fetch-i', authChallengeResponse: { response: 'Default' } }, sessionId: 's' }]);
  });
});
