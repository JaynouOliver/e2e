/**
 * Code spans on the markdown page: a backslash is literal inside one, so the
 * text is verbatim wherever the page is prose, and its cell separator is
 * escaped only in a table row, where GFM takes the backslash back out.
 */

import { describe, expect, it } from 'vitest';
import { cell, code, tableCell } from '../../src/report/markdown-text.ts';
import { renderMarkdownReport } from '../../src/report/markdown.ts';
import { reportAttempt, reportDocument, reportError, reportResult, reportStep, reportTarget } from '../helpers/report.ts';

describe('code', () => {
  it('keeps a pipe as written', () => {
    expect(code('getByRole("button", name: /Save|Submit/)')).toBe('`getByRole("button", name: /Save|Submit/)`');
    expect(code('a`b|c')).toBe('`` a`b|c ``');
    expect(cell('see https://x.test/a|b')).toBe('see `https://x.test/a|b`');
  });
});

describe('tableCell', () => {
  it('escapes the pipes inside code spans and nothing else', () => {
    expect(tableCell(`${cell('a | b')} ${code('c|d|e')} ${code('f`|g')}`)).toBe('a \\| b `c\\|d\\|e` `` f`\\|g ``');
    expect(tableCell(code('|'))).toBe('`\\|`');
    expect(tableCell(code('a\\|b'))).toBe('`a\\\\|b`');
  });

  it('does not take an escaped backtick for the start of a span', () => {
    expect(tableCell(cell('a ` b | c ` d'))).toBe('a \\` b \\| c \\` d');
    expect(tableCell(`${cell('tick ` then')} ${code('x|y')}`)).toBe('tick \\` then `x\\|y`');
  });
});

describe('renderMarkdownReport', () => {
  it('shows a pipe in a code span as written in prose and escaped in a table row', () => {
    const label = 'getByRole("button", name: /Save|Submit/)';
    const failed = reportAttempt({
      status: 'failed',
      error: reportError(),
      steps: [reportStep({ kind: 'assertion', api: 'expect.toBeVisible', label, status: 'failed', error: reportError() })],
    });
    const body = renderMarkdownReport(
      reportDocument({
        status: 'failed',
        targets: [reportTarget()],
        results: [
          reportResult({ titlePath: ['opens https://x.test/a|b'], status: 'failed', attempts: [failed] }),
          reportResult({ id: 'result-2', titlePath: ['pays'], status: 'skipped', selected: false, attempts: [], skip: { cause: 'filtered', reason: 'unaffected', filter: 'areas|owners' } }),
        ],
        filters: [{ name: 'areas|owners', candidates: 2, excluded: 1 }],
      }),
    );
    expect(body).toContain(`at step 1 of 1: \`expect.toBeVisible ${label}\`, after`);
    expect(body).toContain('**🔴 opens `https://x.test/a|b`**  \n');
    expect(body).toContain('**Filter** `areas|owners` ');
    expect(body).toContain('| 🔴 | opens `https://x.test/a\\|b` | ');
    expect(body).toContain(' › pays | `areas\\|owners` | unaffected |');
  });
});
