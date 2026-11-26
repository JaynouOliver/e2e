/**
 * `press` with a character Playwright's keyboard has no key for, inserted as
 * text. Inserted text sends no key event, so only a text field takes it: any
 * other target is refused rather than "pressed" into nothing.
 */

import type { Page } from 'playwright-core';
import { EngineError, parseKey } from '@e2e-dev/core/engine';
import { CLOSED_SHADOW_ROOTS_KEY } from './closed-shadow.ts';
import type { ConnectionBudget } from './operation-budget.ts';
import type { ActionTarget } from './support.ts';

const US_LAYOUT_CHARACTER = /^[ -~]$/;

/**
 * The character of a `press` key that the web engine inserts as text, because
 * Playwright's US keyboard layout has no key for it (`é`, `€`, `中`);
 * `undefined` for a key Playwright presses. Throws `UNSUPPORTED_CAPABILITY`
 * when such a character carries a modifier: inserted text has no key event
 * for a modifier to hold over.
 */
export function requireInsertableCharacter(key: string): string | undefined {
  const parsed = parseKey(key);
  if (parsed?.key.kind !== 'char' || US_LAYOUT_CHARACTER.test(parsed.key.char)) return undefined;
  if (parsed.modifiers.length > 0) {
    throw new EngineError(
      'UNSUPPORTED_CAPABILITY',
      `press cannot hold ${parsed.modifiers.join('+')} with "${parsed.key.char}": Playwright's keyboard has no key for that character; press it alone to type it`,
      { retryable: false },
    );
  }
  return parsed.key.char;
}

/** Focuses the node and inserts the character into it; `checkpoint` is `insertCharacter`'s. */
export async function insertCharacterInto(target: ActionTarget, page: Page, character: string, operation: ConnectionBudget, checkpoint: () => void): Promise<void> {
  const timeout = operation.timeoutMs;
  let focused: boolean;
  if (target.kind === 'locator') {
    await target.locator.focus({ timeout });
    focused = await target.locator.evaluate(holdsFocus, undefined, { timeout });
  } else {
    // An ElementHandle call takes no timeout: the element is already resolved.
    await target.element.focus();
    focused = await target.element.evaluate(holdsFocus);
  }
  // Inserted text lands on whatever holds focus, and a node that cannot take focus leaves it on another field.
  if (!focused) throw notInsertable(character);
  await insertCharacter(page, character, checkpoint);
}

/**
 * Inserts the character into whatever holds focus, in any frame of the page.
 * The focus read can outlast the operation or the connection, so `checkpoint`
 * (`AttemptSession.checkpoint`) runs between it and the insertion.
 */
export async function insertCharacter(page: Page, character: string, checkpoint: () => void): Promise<void> {
  const takesText = await Promise.all(page.frames().map((frame) => frame.evaluate(focusTakesText, CLOSED_SHADOW_ROOTS_KEY).catch(() => false)));
  if (!takesText.some(Boolean)) throw notInsertable(character);
  checkpoint();
  await page.keyboard.insertText(character);
}

/** Runs in the page: whether an element is the focused one of its document or shadow tree. */
function holdsFocus(element: Element): boolean {
  const root = element.getRootNode();
  return (root instanceof Document || root instanceof ShadowRoot) && root.activeElement === element;
}

/**
 * Runs in the page: whether the focused element, through open and recorded
 * closed shadow roots, is an editable input of a free-text type, a textarea,
 * or an editing host, which a body is under `contenteditable` or `designMode`.
 * A number or date input drops inserted text. A frame without focus keeps an
 * active element, an editable body included, that the text would not reach.
 */
function focusTakesText(closedShadowRootsKey: string): boolean {
  if (!document.hasFocus()) return false;
  const recorded: WeakMap<Element, ShadowRoot> | undefined = Reflect.get(globalThis, Symbol.for(closedShadowRootsKey));
  let active = document.activeElement;
  while (active !== null) {
    const leaf = (active.shadowRoot ?? recorded?.get(active))?.activeElement;
    if (leaf === undefined || leaf === null) break;
    active = leaf;
  }
  if (active instanceof HTMLInputElement) {
    return !active.disabled && !active.readOnly && ['text', 'search', 'tel', 'url', 'email', 'password'].includes(active.type);
  }
  if (active instanceof HTMLTextAreaElement) return !active.disabled && !active.readOnly;
  // A control or frame inside an editing host inherits isContentEditable and still takes no text.
  if (active instanceof HTMLSelectElement || active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement ||
      active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement) {
    return false;
  }
  return active instanceof HTMLElement && active.isContentEditable;
}

function notInsertable(character: string): EngineError {
  return new EngineError(
    'NOT_ACTIONABLE',
    `press cannot type "${character}" here: Playwright's keyboard has no key for that character, so it is inserted as text with no key event, and only a focused, editable text field takes it`,
    { retryable: false },
  );
}
