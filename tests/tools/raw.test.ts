import { afterEach, describe, expect, it } from 'vitest';
import { API, connect } from '../helpers.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup(
  body: unknown = [{ StationID: '0990', StationName: { Zh_tw: '南港', En: null } }],
) {
  const t = await connect([['/v2/', body]]);
  close = t.close;
  return t;
}

describe('tdx_get', () => {
  it('passes OData options through and drops empty fields', async () => {
    const t = await setup();
    const result = await t.call('tdx_get', {
      path: '/v2/Rail/THSR/Station',
      filter: "StationID eq '0990'",
      select: ['StationID', 'StationName'],
      orderBy: ['StationID desc'],
      top: 5,
    });
    expect(t.apiUrls).toEqual([
      `${API}/v2/Rail/THSR/Station?$select=StationID,StationName&$filter=StationID eq '0990'&$orderby=StationID desc&$top=5&$format=JSON`,
    ]);
    expect(result.json).toEqual([{ StationID: '0990', StationName: { Zh_tw: '南港' } }]);
  });

  it('defaults top to 30 and accepts a full URL', async () => {
    const t = await setup();
    await t.call('tdx_get', { path: `${API}/v2/Rail/THSR/Station` });
    expect(t.apiUrls).toEqual([`${API}/v2/Rail/THSR/Station?$top=30&$format=JSON`]);
  });

  it.each([
    ['/v2/Rail/THSR/Station?$top=1', /not in the path/],
    ['Rail/THSR/Station', /not a TDX API path/],
    ['/v2/../auth', /not a TDX API path/],
  ])('rejects %s', async (path, message) => {
    const t = await setup();
    const result = await t.call('tdx_get', { path });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(message);
    expect(t.apiUrls).toEqual([]);
  });

  it('rejects a malformed orderBy', async () => {
    const t = await setup();
    const result = await t.call('tdx_get', {
      path: '/v2/Rail/THSR/Station',
      orderBy: ['A sideways'],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/"Field" or "Field desc"/);
  });
});
