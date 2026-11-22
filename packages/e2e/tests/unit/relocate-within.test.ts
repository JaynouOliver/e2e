import { describe, expect, it } from 'vitest';
import type { RedactedNode } from '@e2e-dev/core/lib/agent/observation';
import type { SemanticNode } from '@e2e-dev/core/lib/engine/surface';
import { redacted } from '../helpers/redacted.ts';
import { containerKey, describeAction } from '@e2e-dev/core/lib/agent/actions';
import { describePosition, relocateDescriptor } from '@e2e-dev/core/lib/cache/relocate';

const identity = (text: string): string => text;

/** A two-row table: identical "Delete" buttons told apart only by their row. */
function table(): { nodes: Map<string, RedactedNode>; parents: Map<string, string> } {
  const nodes = new Map<string, RedactedNode>();
  const parents = new Map<string, string>();
  const add = (id: string, node: Omit<SemanticNode, 'ref'>, parent?: string): SemanticNode => {
    const full: SemanticNode = { ref: { id, revision: 'r' }, ...node };
    nodes.set(id, redacted(full));
    if (parent !== undefined) parents.set(id, parent);
    return full;
  };
  const c1 = add('c1', { role: 'cell', text: 'Budget draft' }, 'r1');
  const d1 = add('d1', { role: 'button', name: 'Delete' }, 'r1');
  add('r1', { role: 'row', children: [c1, d1] }, 't');
  const c2 = add('c2', { role: 'cell', text: 'Vendor list' }, 'r2');
  const d2 = add('d2', { role: 'button', name: 'Delete' }, 'r2');
  add('r2', { role: 'row', children: [c2, d2] }, 't');
  add('t', { role: 'table', name: 'Documents' });
  return { nodes, parents };
}

describe('container keys', () => {
  it('names the row a control sits in by the row\'s first text', () => {
    const { nodes, parents } = table();
    expect(containerKey('d1', nodes, parents)).toBe('Budget draft');
    expect(containerKey('d2', nodes, parents)).toBe('Vendor list');
    // The cell itself is the row's key: nothing to add.
    expect(containerKey('c1', nodes, parents)).toBeUndefined();
  });

  it('records the key with the action and reads it back in the prose', () => {
    const { nodes } = table();
    const described = describeAction({ name: 'tap', node: nodes.get('d1')!, within: 'Budget draft' }, { redact: identity, redactCut: identity });
    expect(described.target?.within).toBe('Budget draft');
    expect(described.summary).toBe('tap button "Delete" in "Budget draft"');
  });

  it('relocates a same-named control by its row instead of diverging as ambiguous', () => {
    const { nodes, parents } = table();
    void parents;
    expect(relocateDescriptor({ role: 'button', name: 'Delete', within: 'Vendor list' }, nodes)).toEqual({ kind: 'found', id: 'd2' });
    expect(relocateDescriptor({ role: 'button', name: 'Delete' }, nodes)).toMatchObject({ kind: 'failed', failure: 'target-ambiguous' });
    // The row is gone: not found, never the other row's button.
    expect(relocateDescriptor({ role: 'button', name: 'Delete', within: 'Offsite plan' }, nodes)).toEqual({ kind: 'failed', failure: 'target-not-found' });
  });

  it('keys an icon button by its row\'s own label when the row has no other text, and finds it after the rows reorder', () => {
    // `<li>Alpha <button><svg/></button></li>`: the list item is named from its content, the button by nothing.
    const list = (order: readonly string[]) => {
      const nodes = new Map<string, RedactedNode>();
      const parents = new Map<string, string>();
      for (const label of order) {
        const button: SemanticNode = { ref: { id: `b-${label}`, revision: 'r' }, role: 'button' };
        nodes.set(`li-${label}`, redacted({ ref: { id: `li-${label}`, revision: 'r' }, role: 'listitem', name: label, children: [button] }));
        nodes.set(button.ref.id, redacted(button));
        parents.set(button.ref.id, `li-${label}`);
      }
      return { nodes, parents };
    };
    const recorded = list(['Alpha', 'Beta']);
    const within = containerKey('b-Alpha', recorded.nodes, recorded.parents);
    expect(within).toBe('Alpha');
    const position = describePosition(recorded.nodes.get('b-Alpha')!, within, recorded.nodes);
    expect(position).toEqual({ index: 0, of: 1 });
    const live = list(['Beta', 'Alpha']);
    expect(relocateDescriptor({ role: 'button', within: within!, position: position! }, live.nodes)).toEqual({ kind: 'found', id: 'b-Alpha' });
  });

  /** `<tr><td><button>Archive</button></td><td>Acme</td><td>Open</td></tr>` per customer; `text` is what the button shows, its name or a glyph under an `aria-label`. */
  function leadingRows(text: string, order: readonly string[]): { nodes: Map<string, RedactedNode>; parents: Map<string, string> } {
    const nodes = new Map<string, RedactedNode>();
    const parents = new Map<string, string>();
    for (const customer of order) {
      const button: SemanticNode = { ref: { id: `b-${customer}`, revision: 'r' }, role: 'button', name: 'Archive', text };
      const action: SemanticNode = { ref: { id: `a-${customer}`, revision: 'r' }, role: 'cell', name: 'Archive', children: [button] };
      const name: SemanticNode = { ref: { id: `n-${customer}`, revision: 'r' }, role: 'cell', text: customer };
      const status: SemanticNode = { ref: { id: `s-${customer}`, revision: 'r' }, role: 'cell', text: 'Open' };
      const row: SemanticNode = { ref: { id: `r-${customer}`, revision: 'r' }, role: 'row', name: `Archive ${customer} Open`, children: [action, name, status] };
      for (const node of [button, action, name, status, row]) nodes.set(node.ref.id, redacted(node));
      parents.set(button.ref.id, action.ref.id);
      for (const cell of [action, name, status]) parents.set(cell.ref.id, row.ref.id);
    }
    return { nodes, parents };
  }

  it.each([
    ['its name', 'Archive', undefined],
    ['a glyph', '\u00d7', '\u00d7'],
  ])('keys a control that leads its row and shows %s by the row\'s first text outside it, and finds it after the rows shift', (_shows, text, ownKey) => {
    const recorded = leadingRows(text, ['Globex', 'Acme', 'Initech']);
    expect(containerKey('b-Acme', recorded.nodes, recorded.parents)).toBe(ownKey);
    expect(containerKey('b-Acme', recorded.nodes, recorded.parents, true)).toBe('Acme');
    expect(describePosition(recorded.nodes.get('b-Acme')!, 'Acme', recorded.nodes, true)).toBeUndefined();

    const live = leadingRows(text, ['Stark', 'Globex', 'Acme']);
    expect(relocateDescriptor({ role: 'button', name: 'Archive', within: 'Acme', leads: true }, live.nodes)).toEqual({ kind: 'found', id: 'b-Acme' });
    expect(relocateDescriptor({ role: 'button', name: 'Archive', within: 'Initech', leads: true }, live.nodes)).toEqual({ kind: 'failed', failure: 'target-not-found' });
  });

  it('matches an entry recorded without the mark by the row\'s first text only, as before', () => {
    // Recorded when the label came first; the button now leads its row. The old key no longer holds, so it hands off.
    const live = leadingRows('Archive', ['Stark', 'Globex', 'Acme']);
    expect(relocateDescriptor({ role: 'button', name: 'Archive', within: 'Acme' }, live.nodes)).toEqual({ kind: 'failed', failure: 'target-not-found' });
  });

  it('replays an entry recorded by the glyph and a place as it did before', () => {
    const live = leadingRows('\u00d7', ['Stark', 'Globex', 'Acme']);
    expect(relocateDescriptor({ role: 'button', name: 'Archive', within: '\u00d7', position: { index: 1, of: 3 } }, live.nodes)).toEqual({ kind: 'found', id: 'b-Globex' });
  });

  it('does not read a row that is itself the target by the row after it', () => {
    // Cards that share a label, tapped as a whole: what follows the first one in the list is the next card.
    const cards = (order: readonly string[]) => {
      const nodes = new Map<string, RedactedNode>();
      const rows = order.map((customer): SemanticNode => {
        const title: SemanticNode = { ref: { id: `t-${customer}`, revision: 'r' }, role: 'text', text: customer };
        nodes.set(title.ref.id, redacted(title));
        return { ref: { id: `c-${customer}`, revision: 'r' }, role: 'group', name: 'Card', children: [title] };
      });
      for (const row of rows) nodes.set(row.ref.id, redacted(row));
      nodes.set('list', redacted({ ref: { id: 'list', revision: 'r' }, role: 'group', children: rows }));
      return { nodes, parents: new Map(rows.map((row) => [row.ref.id, 'list'])) };
    };
    const recorded = cards(['Globex', 'Acme']);
    expect(containerKey('c-Globex', recorded.nodes, recorded.parents)).toBe('Globex');
    expect(containerKey('c-Globex', recorded.nodes, recorded.parents, true)).toBe('Globex');

    // A new card on top: the card before Globex is not Globex.
    const live = cards(['Stark', 'Globex', 'Acme']);
    expect(relocateDescriptor({ role: 'group', name: 'Card', within: 'Globex' }, live.nodes)).toEqual({ kind: 'failed', failure: 'target-not-found' });
  });

  it('does not key a row of a windowed list by whichever twin row is rendered first', () => {
    // An Android FlatList: an unnamed group of group rows, the rendered window moving with the scroll.
    const list = (first: number) => {
      const nodes = new Map<string, RedactedNode>();
      const parents = new Map<string, string>();
      const rows: SemanticNode[] = [];
      for (let n = first; n < first + 12; n += 1) {
        const label = `Row ${String(n).padStart(4, '0')}`;
        const text: SemanticNode = { ref: { id: `t-${String(n)}`, revision: 'r' }, role: 'text', text: label };
        const row: SemanticNode = { ref: { id: `row-${String(n)}`, revision: 'r' }, role: 'group', name: label, testId: `row-${String(n)}`, children: [text] };
        nodes.set(text.ref.id, redacted(text));
        nodes.set(row.ref.id, redacted(row));
        parents.set(text.ref.id, row.ref.id);
        parents.set(row.ref.id, 'list');
        rows.push(row);
      }
      nodes.set('list', redacted({ ref: { id: 'list', revision: 'r' }, role: 'group', children: rows }));
      return { nodes, parents };
    };
    const recorded = list(500);
    expect(containerKey('row-512', recorded.nodes, recorded.parents)).toBeUndefined();
    expect(containerKey('t-512', recorded.nodes, recorded.parents)).toBeUndefined();
    // A control inside a row is still keyed by its row.
    expect(containerKey('d1', table().nodes, table().parents)).toBe('Budget draft');
    const live = list(501);
    expect(relocateDescriptor({ role: 'group', name: 'Row 0512', testId: 'row-512' }, live.nodes)).toEqual({ kind: 'found', id: 'row-512' });
  });

  it('keys a control by its nearest container only, so rows with no text of their own share no outer label', () => {
    const nodes = new Map<string, RedactedNode>();
    const parents = new Map<string, string>();
    const button: SemanticNode = { ref: { id: 'b', revision: 'r' }, role: 'button' };
    const group: SemanticNode = { ref: { id: 'g', revision: 'r' }, role: 'group', children: [button] };
    const title: SemanticNode = { ref: { id: 't', revision: 'r' }, text: 'Shipping address' };
    nodes.set('r', redacted({ ref: { id: 'r', revision: 'r' }, role: 'region', children: [title, group] }));
    for (const node of [title, group, button]) nodes.set(node.ref.id, redacted(node));
    parents.set('b', 'g');
    parents.set('g', 'r');
    parents.set('t', 'r');
    expect(containerKey('b', nodes, parents)).toBeUndefined();

    // A row whose first text is the link itself names it already: the list around it says nothing more.
    const link: SemanticNode = { ref: { id: 'l', revision: 'r' }, role: 'link', name: 'Beta' };
    nodes.set('l', redacted(link));
    nodes.set('li', redacted({ ref: { id: 'li', revision: 'r' }, role: 'listitem', name: 'Beta', children: [link] }));
    parents.set('l', 'li');
    parents.set('li', 'r');
    expect(containerKey('l', nodes, parents)).toBeUndefined();
  });
});
