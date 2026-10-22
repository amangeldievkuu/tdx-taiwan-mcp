import { TdxApiError, TdxAuthError, TdxNetworkError, TdxRateLimitError } from 'tdx-taiwan';
import { describe, expect, it } from 'vitest';
import { ToolInputError } from '../../src/core/errors.js';
import { MAX_CHARS, fail, list, ok } from '../../src/core/respond.js';

const textOf = (result: ReturnType<typeof ok>) => (result.content[0] as { text: string }).text;
const URL = 'https://tdx.transportdata.tw/api/basic/v2/Bike/Station/City/Atlantis?%24format=JSON';

describe('ok', () => {
  it('serialises data as JSON text', () => {
    expect(textOf(ok({ a: 1 }))).toBe('{"a":1}');
  });

  it('cuts text beyond MAX_CHARS and says so', () => {
    const text = textOf(ok('x'.repeat(MAX_CHARS * 2)));
    expect(text.length).toBeLessThan(MAX_CHARS + 200);
    expect(text).toMatch(/output cut at/);
  });
});

describe('list', () => {
  it('reports total, returned and truncated', () => {
    const json = JSON.parse(textOf(list([1, 2, 3], 2, { city: 'Taipei' }))) as unknown;
    expect(json).toEqual({ city: 'Taipei', total: 3, returned: 2, truncated: true, items: [1, 2] });
  });

  it('returns fewer items when they would not fit in MAX_CHARS', () => {
    const items = Array.from({ length: 100 }, () => 'y'.repeat(1_000));
    const text = textOf(list(items, 100));
    const json = JSON.parse(text) as { returned: number; truncated: boolean };
    expect(text.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(json.returned).toBeLessThan(40);
    expect(json.truncated).toBe(true);
  });
});

describe('fail', () => {
  it('marks the result as an error', () => {
    expect(fail(new ToolInputError('No match')).isError).toBe(true);
    expect(textOf(fail(new ToolInputError('No match')))).toBe('No match');
  });

  it('keeps the TDX message, with the decoded path', () => {
    const error = new TdxApiError('x', {
      status: 400,
      body: JSON.stringify({ Message: "City: 'Atlantis' 不在可接受的範圍內" }),
      url: URL,
    });
    expect(textOf(fail(error))).toBe(
      "TDX answered HTTP 400 for /v2/Bike/Station/City/Atlantis: City: 'Atlantis' 不在可接受的範圍內.",
    );
  });

  it('adds a hint to 404s', () => {
    const error = new TdxApiError('x', { status: 404, body: '', url: URL });
    expect(textOf(fail(error))).toMatch(/HTTP 404 .* may not exist/);
  });

  it('explains rate limits, auth and network errors', () => {
    expect(
      textOf(fail(new TdxRateLimitError('x', { body: '', url: URL, retryAfterMs: 2_500 }))),
    ).toBe('TDX rate limit reached (HTTP 429) after several retries. Retry after about 3 s.');
    expect(textOf(fail(new TdxAuthError('bad', { status: 401 })))).toMatch(
      /authentication failed \(HTTP 401\): check TDX_CLIENT_ID/,
    );
    expect(textOf(fail(new TdxNetworkError('timeout', { url: URL })))).toBe(
      'Could not reach TDX: timeout',
    );
    expect(textOf(fail(new Error('boom')))).toBe('Unexpected error: boom');
  });
});
