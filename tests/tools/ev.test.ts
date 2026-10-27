import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

const ROUTES: Route[] = [
  ['/v1/EV/Station/City/Taipei', loadFixture('ev-station-taipei.json')],
  ['/v1/EV/Connector/City/Taipei', loadFixture('ev-connector-taipei.json')],
  ['/v1/EV/ConnectorLiveStatus/City/Taipei', loadFixture('ev-live-status-taipei.json')],
  ['/v1/EV/Station/Freeway/ServiceArea', loadFixture('ev-station-freeway.json')],
  ['/v1/EV/Connector/Freeway/ServiceArea', { UpdateInterval: 60, Connectors: [] }],
  ['/v1/EV/ConnectorLiveStatus/Freeway/ServiceArea', { UpdateInterval: 60, LiveStatuses: [] }],
];

// Between 國立臺灣大學 (TPE0201U01) and 中山國中站 (about 4.6 km apart).
const NTU = { lat: 25.0197, lon: 121.5402, city: 'Taipei' };

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const t = await connect(ROUTES);
  close = t.close;
  return t;
}

describe('ev_charger_nearby', () => {
  it('lists stations with a free connector, with live counts per connector', async () => {
    const t = await setup();
    const result = await t.call('ev_charger_nearby', NTU);
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v1/EV/Connector/City/Taipei?$format=JSON`,
      `${API}/v1/EV/ConnectorLiveStatus/City/Taipei?$format=JSON`,
      `${API}/v1/EV/Station/City/Taipei?$format=JSON`,
    ]);
    expect(result.json.items).toEqual([
      {
        name: '國立臺灣大學校總區平面停車場',
        distanceMeters: 6,
        address: '羅斯福路4段1號臺北市羅斯福路四段一號',
        connectors: [
          { type: 'CCS2', power: 'DC', count: 4 },
          {
            type: 'Tesla',
            power: 'DC',
            count: 2,
            maxPower: '250kW',
            free: 1,
            inUse: 0,
            outOfOrder: 0,
          },
        ],
        serviceTime: '7x24小時',
        chargingRate: '計度/浮動/8元每度',
        parkingRate: '計時/每日/60元每小時',
        floors: 'B2',
        id: 'TPE0201U01',
        lat: 25.01972,
        lon: 121.54025,
        updated: '2026-10-21T11:39:00+08:00',
      },
    ]);
  });

  it('joins a status to its station through the connector, and shows busy stations with want "any"', async () => {
    const t = await setup();
    const near = { lat: 25.06043, lon: 121.54553, city: '台北' };
    const free = await t.call('ev_charger_nearby', near);
    expect(free.json.total).toBe(0);
    expect(free.json.note).toBe(
      'No station in range has a free connector of that kind right now (stations in range: 1, ' +
        'without live status: 0). Use want "any" to list them.',
    );
    const any = await t.call('ev_charger_nearby', { ...near, want: 'any' });
    expect(any.json.items[0]).toMatchObject({
      name: '中山國中站',
      address: '台北市松山區復興北路361巷7號B1-B2停車場',
      connectors: [
        { type: 'J1772', power: 'AC', count: 6, maxPower: '7KW', free: 0, inUse: 1, outOfOrder: 0 },
      ],
    });
    expect(any.json.unattributed).toBeUndefined();
  });

  it('filters by connector type and power', async () => {
    const t = await setup();
    const ccs2 = await t.call('ev_charger_nearby', { ...NTU, connector: 'CCS2' });
    expect(ccs2.json).toMatchObject({ total: 0 });
    const ccs2Any = await t.call('ev_charger_nearby', { ...NTU, connector: 'CCS2', want: 'any' });
    expect(ccs2Any.json.items.map((i) => i.id)).toEqual(['TPE0201U01']);
    const ac = await t.call('ev_charger_nearby', {
      ...NTU,
      power: 'AC',
      want: 'any',
      radiusMeters: 10_000,
    });
    expect(ac.json.items.map((i) => i.name)).toEqual(['中山國中站']);
  });

  it('reads the freeway service areas', async () => {
    const t = await setup();
    const result = await t.call('ev_charger_nearby', {
      lat: 24.857,
      lon: 121.009,
      city: 'freeway',
      want: 'any',
    });
    expect(t.apiUrls.every((url) => url.includes('/Freeway/ServiceArea'))).toBe(true);
    expect(result.json.items[0]).toMatchObject({
      name: '湖口服務區南站',
      address: '國道1號 湖口服務區南站',
      restriction: '本充電站限會員使用',
    });
  });

  it('rejects an area without EV data without calling TDX', async () => {
    const t = await setup();
    const result = await t.call('ev_charger_nearby', { ...NTU, city: 'LienchiangCounty' });
    expect(result.text).toMatch(/^TDX has no EV charging data for "LienchiangCounty"/);
    expect(t.apiUrls).toEqual([]);
  });
});
