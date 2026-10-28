import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

interface SectionsWrapper {
  Sections: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// The section fixture and the live fixture were trimmed to different sections; give the
// sections the IDs of the first two live readings so they join.
const taipeiSections = loadFixture('traffic-section-taipei.json') as SectionsWrapper;
const TAIPEI_SECTIONS = {
  ...taipeiSections,
  Sections: taipeiSections.Sections.map((s, i) => ({
    ...s,
    SectionID: ['L_2000100000500A', 'L_2000101007000A'][i],
  })),
};
const FREEWAY_LIVE = {
  UpdateInterval: 60,
  AuthorityCode: 'NFB',
  LiveTraffics: [
    {
      SectionID: '0001',
      TravelTime: 42,
      TravelSpeed: 95,
      CongestionLevelID: 'A',
      CongestionLevel: '1',
      DataCollectTime: '2026-10-21T14:48:00+08:00',
    },
    {
      SectionID: '0475',
      TravelTime: 120,
      TravelSpeed: 30,
      CongestionLevelID: 'A',
      CongestionLevel: '4',
      DataCollectTime: '2026-10-21T14:48:00+08:00',
    },
  ],
};

/** Two freeway cameras: the SDK's camera fixture is Taipei's. */
const FREEWAY_CAMERAS = {
  UpdateInterval: 21600,
  CCTVs: [
    {
      CCTVID: 'CCTV-N1-S-38.300-M',
      VideoStreamURL: 'https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=13830',
      PositionLon: 121.393198,
      PositionLat: 25.063245,
      RoadName: '國道1號',
      RoadDirection: 'S',
      RoadSection: { Start: '泰山轉接道', End: '林口交流道' },
      LocationMile: '38K+300',
    },
    {
      CCTVID: 'CCTV-N1-N-12.080-M',
      VideoStreamURL: 'https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=11208',
      PositionLon: 121.638828,
      PositionLat: 25.071347,
      RoadName: '國道1號',
      RoadDirection: 'N',
      RoadSection: { Start: '高架汐止端', End: '汐止系統交流道' },
      LocationMile: '12K+080',
    },
  ],
};

/** What the two freeway signs of the fixture show, plus a sign TDX has no record of. */
const FREEWAY_SIGNS_LIVE = {
  UpdateInterval: 60,
  CMSLives: [
    {
      CMSID: 'CMS-N1-S-0.000-M',
      MessageStatus: 1,
      Messages: [{ Text: '平面10-15K內線移動施工請小心駕駛', Type: 7, Priority: 51 }],
      Status: 0,
      DataCollectTime: '2026-10-21T14:34:00+08:00',
    },
    {
      CMSID: 'CMS-N1-S-0.730-M',
      MessageStatus: 1,
      Messages: [
        { Text: '至  汐止  約 7分至  \u3000\u3000  約12分', Type: 1 },
        { Text: ' ', Type: 7 },
      ],
      Status: 0,
      DataCollectTime: '2026-10-21T14:34:00+08:00',
    },
    {
      CMSID: 'CMS-N1-S-9.999-M',
      MessageStatus: 0,
      Messages: [{ Text: ' ' }],
      Status: 0,
      DataCollectTime: '2026-10-21T14:34:00+08:00',
    },
  ],
};

const ROUTES: Route[] = [
  ['/v2/Road/Traffic/Section/City/Taipei', TAIPEI_SECTIONS],
  ['/v2/Road/Traffic/Live/City/Taipei', loadFixture('traffic-live-taipei.json')],
  [
    '/v2/Road/Traffic/CongestionLevel/City/Taipei',
    loadFixture('traffic-congestion-level-taipei.json'),
  ],
  ['/v2/Road/Traffic/Section/Freeway', loadFixture('traffic-section-by-id-freeway.json')],
  ['/v2/Road/Traffic/Live/Freeway', FREEWAY_LIVE],
  [
    '/v2/Road/Traffic/CongestionLevel/Freeway',
    loadFixture('traffic-congestion-level-freeway.json'),
  ],
  ['/v1/Traffic/RoadEvent/LiveEvent/Freeway', loadFixture('traffic-live-event-freeway.json')],
  ['/v1/Traffic/RoadEvent/LiveEvent/City/Taipei', { UpdateInterval: 60, LiveEvents: [] }],
  ['/v1/Traffic/RoadEvent/Event/City/Taipei', loadFixture('traffic-event-taipei.json')],
  ['/v2/Road/Traffic/Live/News/Freeway', loadFixture('traffic-news-freeway.json')],
  ['/v2/Road/Traffic/Live/News/City/Taipei', { UpdateInterval: 60, Newses: [] }],
  ['/v2/Road/Traffic/CCTV/City/Taipei', loadFixture('traffic-cctv-taipei.json')],
  ['/v2/Road/Traffic/CCTV/Freeway', FREEWAY_CAMERAS],
  ['/v2/Road/Traffic/CMS/Freeway', loadFixture('traffic-cms-freeway.json')],
  ['/v2/Road/Traffic/Live/CMS/Freeway', FREEWAY_SIGNS_LIVE],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const t = await connect(ROUTES);
  close = t.close;
  return t;
}

describe('traffic_live', () => {
  it('lists a city’s sections worst first, with a count per level', async () => {
    const t = await setup();
    const result = await t.call('traffic_live', { network: '臺北市' });
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v2/Road/Traffic/CongestionLevel/City/Taipei?$format=JSON`,
      `${API}/v2/Road/Traffic/Live/City/Taipei?$format=JSON`,
      `${API}/v2/Road/Traffic/Section/City/Taipei?$format=JSON`,
    ]);
    expect(result.json).toMatchObject({
      network: 'Taipei',
      levels: { 'F (6/6)': 1, 'A (1/6)': 1, 'no data': 1 },
    });
    expect(result.json.unmatched).toBeUndefined();
    expect(result.json.items).toEqual([
      {
        road: '水源快速道路',
        section: '水源快速道路(95BJPDPX到95EVPDSG)',
        direction: 'southeastbound',
        congestion: 'F (6/6)',
        speedKmh: 25,
        travelTimeSeconds: 33,
        updated: '2026-10-21T14:48:00+08:00',
      },
      expect.objectContaining({ congestion: 'A (1/6)', speedKmh: 73 }),
      {
        section: 'L_2000100100680F (no section record)',
        congestion: 'no data',
        updated: '2026-10-21T14:48:00+08:00',
      },
    ]);
  });

  it('filters by keyword or position, leaving out readings without a section', async () => {
    const t = await setup();
    const named = await t.call('traffic_live', { network: 'Taipei', keyword: '水源' });
    expect(named.json).toMatchObject({ total: 2, unmatched: 1 });
    const near = await t.call('traffic_live', {
      network: 'Taipei',
      lat: 25.017775,
      lon: 121.49366,
      radiusMeters: 200,
    });
    expect(near.json.items).toEqual([
      expect.objectContaining({ congestion: 'A (1/6)', distanceMeters: 0 }),
    ]);
  });

  it('reads the freeways, with mileage and scale names', async () => {
    const t = await setup();
    const result = await t.call('traffic_live', { network: '國道' });
    expect(result.json).toMatchObject({ network: 'national freeways (國道)' });
    expect(result.json.items).toEqual([
      {
        section: '0475 (no section record)',
        congestion: '壅塞 (4/5)',
        speedKmh: 30,
        travelTimeSeconds: 120,
        updated: '2026-10-21T14:48:00+08:00',
      },
      {
        road: '國道1號',
        section: '國道1號(基隆端到基隆)',
        direction: 'southbound',
        km: '0K+000–1K+100',
        congestion: '順暢 (1/5)',
        speedKmh: 95,
        travelTimeSeconds: 42,
        speedLimit: 100,
        updated: '2026-10-21T14:48:00+08:00',
      },
    ]);
    const north = await t.call('traffic_live', { network: 'freeway', direction: 'N' });
    expect(north.json.total).toBe(0);
  });

  it('rejects coordinates on the freeways and cities without live traffic, without calling TDX', async () => {
    const t = await setup();
    const freeway = await t.call('traffic_live', { network: 'freeway', lat: 25.06, lon: 121.36 });
    expect(freeway.text).toMatch(/^Freeway sections carry no coordinates/);
    const kaohsiung = await t.call('traffic_live', { network: 'Kaohsiung' });
    expect(kaohsiung.text).toMatch(/^TDX has no live traffic for Kaohsiung/);
    const atlantis = await t.call('traffic_live', { network: 'Atlantis' });
    expect(atlantis.text).toMatch(/^Unknown road network "Atlantis"/);
    expect(t.apiUrls).toEqual([]);
  });
});

describe('traffic_events', () => {
  it('describes freeway events, newest first', async () => {
    const t = await setup();
    const result = await t.call('traffic_events', { network: 'freeway' });
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v1/Traffic/RoadEvent/LiveEvent/Freeway?$format=JSON`,
      `${API}/v2/Road/Traffic/Live/News/Freeway?$format=JSON`,
    ]);
    expect(result.json.news).toEqual([
      expect.objectContaining({ title: '封閉預告', published: '2026-10-20T08:49:00+08:00' }),
      expect.objectContaining({ title: '封閉預告', published: '2026-10-19T07:23:00+08:00' }),
    ]);
    expect(result.json.items).toEqual([
      {
        title: '施工事件',
        type: 'works',
        where: '國道一號 南向 67K+500–68K+500 (幼獅–楊梅)',
        description: '國道一號 南向 67K+500 施工事件-施工維護',
        impact: '部分阻斷交通',
        severity: 'partly blocked',
        blockedLanes: '2,RS',
        start: '2026-10-21T07:00:00+08:00',
        source: '高公局北區交控中心',
        lat: 24.922922,
        lon: 121.169496,
        updated: '2026-10-21T12:21:35+08:00',
      },
      expect.objectContaining({
        type: 'congestion',
        where: '國道一號 北向 41K+500 (林口 出口)',
        severity: 'no impact',
      }),
    ]);
  });

  it('filters by keyword, type and distance', async () => {
    const t = await setup();
    const yangmei = await t.call('traffic_events', { network: 'freeway', keyword: '楊梅' });
    expect(yangmei.json.items.map((i) => i.type)).toEqual(['works']);
    const linkou = { network: 'freeway', lat: 25.0647, lon: 121.3623 };
    const near = await t.call('traffic_events', linkou);
    expect(near.json.items).toEqual([
      expect.objectContaining({ type: 'congestion', distanceMeters: 2 }),
    ]);
    const wide = await t.call('traffic_events', { ...linkou, radiusMeters: 50_000 });
    expect(wide.json.items.map((i) => i.type)).toEqual(['congestion', 'works']);
    const accidents = await t.call('traffic_events', { network: 'freeway', type: 'accident' });
    expect(accidents.json).toMatchObject({ total: 0, note: 'No road events match.' });
  });

  it('keeps one copy of an event TDX repeats or lists in both feeds', async () => {
    const parade = (loadFixture('traffic-event-taipei.json') as { Events: unknown[] }).Events[0];
    const t = await connect([
      ['/v1/Traffic/RoadEvent/LiveEvent/City/Taipei', { LiveEvents: [parade, parade] }],
      ...ROUTES,
    ]);
    close = t.close;
    const result = await t.call('traffic_events', { network: 'Taipei' });
    expect(result.json.items).toHaveLength(1);
    expect(result.json.items[0]?.planned).toBeUndefined();
  });

  it('adds a city’s announced events', async () => {
    const t = await setup();
    const result = await t.call('traffic_events', { network: 'Taipei' });
    expect(result.json.items).toEqual([
      expect.objectContaining({
        title: '第24屆臺灣同志遊行',
        type: 'event',
        planned: true,
        start: '2026-10-30T00:00:00+08:00',
        end: '2026-11-01T00:00:00+08:00',
      }),
    ]);
    expect(result.json.items[0]?.where).toMatch(/^北路線：新仁愛路/);
  });
});

describe('traffic_events news', () => {
  it('leaves the news out when the events are filtered', async () => {
    const t = await setup();
    const result = await t.call('traffic_events', { network: 'freeway', type: 'works' });
    expect(result.json.news).toBeUndefined();
    expect(t.apiUrls.some((url) => url.includes('/News/'))).toBe(false);
  });
});

describe('traffic_cameras', () => {
  it('finds cameras by place along a road, with their streams', async () => {
    const t = await setup();
    const result = await t.call('traffic_cameras', { network: '國道', keyword: '林口' });
    expect(result.json.items).toEqual([
      {
        road: '國道1號',
        at: '38K+300 泰山轉接道–林口交流道',
        direction: 'southbound',
        stream: 'https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=13830',
        id: 'CCTV-N1-S-38.300-M',
        lat: 25.063245,
        lon: 121.393198,
      },
    ]);
    const north = await t.call('traffic_cameras', { network: 'freeway', direction: 'N' });
    expect(north.json.items.map((i) => i.id)).toEqual(['CCTV-N1-N-12.080-M']);
  });

  it('finds city cameras nearest a point', async () => {
    const t = await setup();
    const result = await t.call('traffic_cameras', {
      network: 'Taipei',
      lat: 25.0486,
      lon: 121.5164,
      radiusMeters: 1500,
    });
    expect(result.json.items.map((i) => [i.id, i.distanceMeters])).toEqual([
      ['T000001', 6],
      ['T000002', 1046],
    ]);
  });
});

describe('traffic_signs', () => {
  it('shows what each sign says, cleaned, without blank messages or idle signs', async () => {
    const t = await setup();
    const result = await t.call('traffic_signs', { network: 'freeway' });
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v2/Road/Traffic/CMS/Freeway?$format=JSON`,
      `${API}/v2/Road/Traffic/Live/CMS/Freeway?$format=JSON`,
    ]);
    expect(result.json.items.map((i) => [i.at, i.messages])).toEqual([
      ['0K+000 基隆端–基隆交流道', [{ text: '平面10-15K內線移動施工請小心駕駛', type: 'other' }]],
      ['0K+730 基隆端–基隆交流道', [{ text: '至 汐止 約 7分至 約12分', type: 'travel time' }]],
    ]);
    const travel = await t.call('traffic_signs', { network: 'freeway', keyword: '汐止' });
    expect(travel.json.items.map((i) => i.id)).toEqual(['CMS-N1-S-0.730-M']);
  });
});
