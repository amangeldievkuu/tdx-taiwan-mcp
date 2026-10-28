import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  TrafficCongestionLevels,
  TrafficEventLocation,
  TrafficEvents,
  TrafficLiveEvents,
  TrafficLiveTraffics,
  TrafficNews,
  TrafficSection,
  TrafficSections,
} from 'tdx-taiwan';
import { z } from 'zod';
import { CITIES, normalizeCity } from '../core/cities.js';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { arrayOf, HEADING, plain, realTime } from '../core/format.js';
import { haversine, type LatLon, pointFromWkt, pointOf } from '../core/geo.js';
import { search } from '../core/names.js';
import { list } from '../core/respond.js';
import { limit, radius, take } from '../core/schemas.js';
import { defineTool } from '../core/tool.js';

/** Cities with a live traffic feed. */
const LIVE_CITIES = [
  'Taipei',
  'Taoyuan',
  'Taichung',
  'Tainan',
  'Keelung',
  'YilanCounty',
  'ChanghuaCounty',
  'YunlinCounty',
  'PingtungCounty',
];
/** Cities with an announced (planned) road event feed. */
const EVENT_CITIES = [
  'Taipei',
  'NewTaipei',
  'Taoyuan',
  'Taichung',
  'Tainan',
  'Keelung',
  'MiaoliCounty',
  'ChiayiCounty',
  'PingtungCounty',
  'YilanCounty',
  'KinmenCounty',
];
/** Cities with a live road event feed. */
const LIVE_EVENT_CITIES = [...EVENT_CITIES, 'Kaohsiung'];

/** Congestion levels with no level of service. */
const LEVEL_SENTINEL: Record<string, string> = { '0': 'unknown', '-1': 'closed', '-99': 'no data' };
const EVENT_TYPES = {
  accident: 1,
  works: 2,
  congestion: 3,
  control: 4,
  weather: 5,
  disaster: 6,
  event: 7,
  other: 8,
} as const;
const EVENT_TYPE = Object.fromEntries(
  Object.entries(EVENT_TYPES).map(([word, code]) => [code, word]),
) as Record<number, string>;
/** `BlockedLanes` values that list no lane: none, not provided, other, unknown. */
const NO_LANES = ['-1', '-99', '254', '255'];
const SEVERITY: Record<number, string> = {
  0: 'no impact',
  1: 'partly blocked',
  2: 'fully blocked',
};

export type Network = { kind: 'freeway' | 'highway' } | { kind: 'city'; city: string };

export const network = z
  .string()
  .trim()
  .min(1)
  .describe(
    'Road network: "freeway" (國道, national freeways), "highway" (省道, provincial highways) ' +
      'or a city (Taipei, Taoyuan, Taichung, 臺北市, ...).',
  );
export const keyword = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe('Only results whose road or place contains this, e.g. "國道1號", "林口", "建國高架".');
export const latitude = z
  .number()
  .min(21)
  .max(27)
  .optional()
  .describe('Latitude, to search nearby.');
export const longitude = z
  .number()
  .min(118)
  .max(123)
  .optional()
  .describe('Longitude, to search nearby.');

export function registerTrafficTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'traffic_live', {
    title: 'Live road traffic',
    description:
      'Live speed and congestion of road sections on the national freeways, provincial ' +
      'highways or a city’s roads, most congested first, with a count of sections per ' +
      'congestion level. Freeway sections are named after interchanges, so search them by ' +
      'keyword; city sections can also be searched by lat/lon. Example: network "freeway", ' +
      'keyword "林口"; or network "Taipei", lat 25.0478, lon 121.517.',
    input: {
      network,
      keyword,
      direction: z
        .enum(['N', 'S', 'E', 'W'])
        .optional()
        .describe('Only sections heading this way (S also matches SE and SW).'),
      lat: latitude,
      lon: longitude,
      radiusMeters: radius(1000, 10_000),
      limit: limit(20, 'sections'),
    },
    run: async (args) => {
      const net = networkOf(args.network, LIVE_CITIES, 'live traffic');
      const origin = pointArg(args.lat, args.lon);
      if (origin && net.kind !== 'city') {
        throw new ToolInputError(
          `${net.kind === 'freeway' ? 'Freeway' : 'Highway'} sections carry no coordinates; ` +
            'search them by keyword instead, with a road or interchange name ("國道1號", "林口").',
        );
      }
      const [sections, live, scales] = await liveFeeds(ctx, net);
      const sectionById = new Map(arrayOf(sections?.Sections).map((s) => [s.SectionID, s]));
      const levelNames = new Map<string, { name: string; max: number }>();
      for (const scale of arrayOf(scales.CongestionLevels)) {
        const max = Math.max(...scale.Levels.map((l) => l.Level));
        for (const l of scale.Levels) {
          levelNames.set(`${scale.CongestionLevelID}:${l.Level}`, { name: l.LevelName, max });
        }
      }
      const filtered = Boolean(args.keyword || args.direction || origin);
      let unmatched = 0;
      const rows = arrayOf(live.LiveTraffics).flatMap((t) => {
        const section = t.SectionID ? sectionById.get(t.SectionID) : undefined;
        if (!section && filtered) {
          unmatched++;
          return [];
        }
        if (args.direction && !section?.RoadDirection.startsWith(args.direction)) return [];
        const start = pointOf(section?.SectionStart) ?? pointOf(section?.SectionEnd);
        const distance = origin && start ? haversine(origin, start) : undefined;
        if (origin && (distance === undefined || distance > (args.radiusMeters ?? 1000))) {
          return [];
        }
        const level = Number(t.CongestionLevel);
        const scale = levelNames.get(`${t.CongestionLevelID}:${t.CongestionLevel}`);
        const congestion =
          LEVEL_SENTINEL[t.CongestionLevel] ??
          (scale ? `${scale.name} (${level}/${scale.max})` : `level ${t.CongestionLevel}`);
        return [{ t, section, level, congestion, distance }];
      });
      const found = args.keyword
        ? search(
            rows,
            ({ section: s }) => [
              s?.SectionName,
              s?.RoadName,
              s?.RoadSection.Start,
              s?.RoadSection.End,
            ],
            args.keyword,
          )
        : rows;
      // Closed roads first, then the worst level of service, then the slowest.
      const rank = (level: number) => (level === -1 ? 100 : level > 0 ? level : -100);
      const items = [...found]
        .sort(
          (a, b) =>
            rank(b.level) - rank(a.level) ||
            (a.t.TravelSpeed > 0 ? a.t.TravelSpeed : Infinity) -
              (b.t.TravelSpeed > 0 ? b.t.TravelSpeed : Infinity),
        )
        .map(({ t, section, congestion, distance }) => ({
          road: section?.RoadName,
          section: section ? section.SectionName : `${t.SectionID ?? '?'} (no section record)`,
          direction: section && (HEADING[section.RoadDirection] ?? section.RoadDirection),
          km: kmRange(section),
          congestion,
          speedKmh: t.TravelSpeed > 0 ? t.TravelSpeed : undefined,
          travelTimeSeconds: t.TravelTime > 0 ? t.TravelTime : undefined,
          speedLimit: section?.SpeedLimit,
          distanceMeters: distance === undefined ? undefined : Math.round(distance),
          updated: t.DataCollectTime,
        }));
      const levels: Record<string, number> = {};
      for (const item of items) levels[item.congestion] = (levels[item.congestion] ?? 0) + 1;
      return list(items, take(ctx, args.limit, 20), {
        network: label(net),
        levels,
        unmatched: unmatched || undefined,
        note: sections
          ? undefined
          : 'TDX did not answer for the section list, so road names are missing.',
      });
    },
  });

  defineTool(server, 'traffic_events', {
    title: 'Road incidents and closures',
    description:
      'Current road events: accidents, roadworks, congestion, traffic control and weather ' +
      'closures, plus announced events (parades, planned works) for cities and provincial ' +
      'highways, with where they are and how much they block. Example: network "freeway", ' +
      'type "accident"; or network "Taipei", lat 25.0478, lon 121.517.',
    input: {
      network,
      keyword,
      type: z
        .enum(
          Object.keys(EVENT_TYPES) as [
            keyof typeof EVENT_TYPES,
            ...Array<keyof typeof EVENT_TYPES>,
          ],
        )
        .optional()
        .describe(`Only one kind: ${Object.keys(EVENT_TYPES).join(', ')}.`),
      lat: latitude,
      lon: longitude,
      radiusMeters: radius(5000, 50_000),
      limit: limit(20, 'events'),
    },
    run: async (args) => {
      const net = networkOf(args.network, LIVE_EVENT_CITIES, 'road events');
      const origin = pointArg(args.lat, args.lon);
      const filtered = Boolean(args.keyword || args.type || origin);
      const [[live, planned], news] = await Promise.all([
        eventFeeds(ctx, net),
        filtered ? [] : newsOf(ctx, net),
      ]);
      // TDX repeats some events within a feed, and an announced event that has started is in
      // the live feed too: keep the first copy, live before announced.
      const seen = new Set<string>();
      const events = [
        ...arrayOf(live.LiveEvents).map((event) => ({ event, planned: false })),
        ...arrayOf(planned?.Events).map((event) => ({ event, planned: true })),
      ].filter(({ event }) => {
        if (seen.has(event.EventID)) return false;
        seen.add(event.EventID);
        return true;
      });
      const wanted = args.type ? EVENT_TYPES[args.type] : undefined;
      const rows = events.flatMap(({ event, planned }) => {
        if (wanted !== undefined && event.EventType !== wanted) return [];
        const position = pointFromWkt(event.Positions);
        const distance = origin && position ? haversine(origin, position) : undefined;
        if (origin && (distance === undefined || distance > (args.radiusMeters ?? 5000))) return [];
        return [{ event, planned, position, distance, where: where(event.Location) }];
      });
      const found = args.keyword
        ? search(rows, (r) => [r.event.EventTitle, r.event.Description, r.where], args.keyword)
        : rows;
      const items = [...found]
        .sort((a, b) =>
          origin
            ? (a.distance ?? 0) - (b.distance ?? 0)
            : Number(a.planned) - Number(b.planned) ||
              (b.event.LastUpdateTime ?? '').localeCompare(a.event.LastUpdateTime ?? ''),
        )
        .map(({ event: e, planned, position, distance, where }) => {
          const duration = e.Impact?.Duration;
          return {
            title: e.EventTitle,
            type: e.EventType === undefined ? undefined : EVENT_TYPE[e.EventType],
            where,
            description: plain(e.Description),
            impact: e.Impact?.Description || undefined,
            severity: e.Impact?.Severity === undefined ? undefined : SEVERITY[e.Impact.Severity],
            blockedLanes:
              e.Impact?.BlockedLanes && !NO_LANES.includes(e.Impact.BlockedLanes)
                ? e.Impact.BlockedLanes
                : undefined,
            start: realTime(e.EffectiveTime ?? duration?.DurationStartTime),
            end: realTime(e.ExpireTime ?? duration?.DurationEndTime),
            planned: planned || undefined,
            source: e.Source || undefined,
            lat: position?.lat,
            lon: position?.lon,
            distanceMeters: distance === undefined ? undefined : Math.round(distance),
            updated: realTime(e.LastUpdateTime),
          };
        });
      return list(items, take(ctx, args.limit, 20), {
        network: label(net),
        news: news.length
          ? [...news]
              .sort((a, b) => b.PublishTime.localeCompare(a.PublishTime))
              .slice(0, 5)
              .map((n) => {
                const description = plain(n.Description);
                return {
                  title: n.Title,
                  description: description !== n.Title ? description : undefined,
                  published: realTime(n.PublishTime),
                  from: realTime(n.StartTime),
                  to: realTime(n.EndTime),
                  url: n.NewsURL || undefined,
                };
              })
          : undefined,
        note: items.length ? undefined : 'No road events match.',
      });
    },
  });
}

/** `freeway`, `highway` or a city, checked against the cities that have the feed. */
export function networkOf(input: string, cities: readonly string[], what: string): Network {
  const folded = input
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (['freeway', 'freeways', 'nationalfreeway', '國道', '高速公路'].includes(folded)) {
    return { kind: 'freeway' };
  }
  if (['highway', 'highways', 'provincialhighway', '省道', '公路'].includes(folded)) {
    return { kind: 'highway' };
  }
  const city = normalizeCity(input);
  if (!(city in CITIES)) {
    throw new ToolInputError(
      `Unknown road network "${input}". Use "freeway", "highway" or a city (${cities.join(', ')}).`,
    );
  }
  if (!cities.includes(city)) {
    throw new ToolInputError(
      `TDX has no ${what} for ${city}. It covers "freeway", "highway" and ${cities.join(', ')}.`,
    );
  }
  return { kind: 'city', city };
}

export function label(net: Network): string {
  if (net.kind === 'city') return net.city;
  return net.kind === 'freeway' ? 'national freeways (國道)' : 'provincial highways (省道)';
}

export function pointArg(lat: number | undefined, lon: number | undefined): LatLon | undefined {
  if (lat === undefined && lon === undefined) return undefined;
  if (lat === undefined || lon === undefined) {
    throw new ToolInputError('Give both lat and lon, or neither.');
  }
  return { lat, lon };
}

/** Sections (optional: the join is loose anyway), live readings and congestion scales. */
function liveFeeds(
  ctx: ToolContext,
  net: Network,
): Promise<[TrafficSections | undefined, TrafficLiveTraffics, TrafficCongestionLevels]> {
  const traffic = ctx.tdx.traffic;
  if (net.kind === 'city') {
    return Promise.all([
      traffic.sections(net.city).catch(() => undefined),
      traffic.liveTraffic(net.city),
      traffic.congestionLevels(net.city),
    ]);
  }
  const road = traffic[net.kind];
  return Promise.all([
    road.sections().catch(() => undefined),
    road.liveTraffic(),
    road.congestionLevels(),
  ]);
}

/** Live events, and the announced events where the network has them (not the freeways). */
function eventFeeds(
  ctx: ToolContext,
  net: Network,
): Promise<[TrafficLiveEvents, TrafficEvents | undefined]> {
  const traffic = ctx.tdx.traffic;
  if (net.kind === 'city') {
    return Promise.all([
      traffic.liveEvents(net.city),
      EVENT_CITIES.includes(net.city) ? traffic.events(net.city) : undefined,
    ]);
  }
  return Promise.all([
    traffic[net.kind].liveEvents(),
    net.kind === 'highway' ? traffic.highway.events() : undefined,
  ]);
}

/** Road news of the network (closures, control measures); none if TDX has no feed for it. */
async function newsOf(ctx: ToolContext, net: Network): Promise<TrafficNews[]> {
  const traffic = ctx.tdx.traffic;
  const list =
    net.kind === 'city'
      ? traffic.news(net.city)
      : net.kind === 'freeway'
        ? traffic.freeway.news()
        : traffic.highway.news();
  return list.then((l) => [...arrayOf(l.Newses)]).catch((): TrafficNews[] => []);
}

/** `0K+000–1K+100`, when the section has mileage. */
function kmRange(section: TrafficSection | undefined): string | undefined {
  const mile = section?.SectionMile;
  if (!mile?.StartKM) return undefined;
  return mile.EndKM && mile.EndKM !== mile.StartKM ? `${mile.StartKM}–${mile.EndKM}` : mile.StartKM;
}

/** A readable place: `國道一號 北向 41K+500 (林口 出口)`, a road list, an address or free text. */
function where(location: TrafficEventLocation): string | undefined {
  const parts: string[] = [];
  const highway = location.FreeExpressHighway;
  if (highway) {
    const km =
      highway.EndKM && highway.EndKM !== highway.StartKM
        ? `${highway.StartKM}–${highway.EndKM}`
        : highway.StartKM;
    const near = highway.Interchange
      ? [highway.Interchange, highway.Ramp?.EntryExit].filter(Boolean).join(' ')
      : [highway.SectionStart, highway.SectionEnd].filter(Boolean).join('–');
    parts.push(
      [highway.Road, highway.Direction, km].filter(Boolean).join(' ') + (near ? ` (${near})` : ''),
    );
  }
  for (const r of location.CityRoad?.Roadways ?? []) {
    const between = [r.SectionStart, r.SectionEnd].filter(Boolean).join('–');
    parts.push(`${r.City}${r.Town}${r.Road}${between ? ` (${between})` : ''}`);
  }
  if (location.Intersection) {
    parts.push(`${location.Intersection.City} ${location.Intersection.Roads.join(' / ')}`);
  }
  const address = location.Address;
  if (address) {
    const numbers = [address.StartNo, address.EndNo].filter(Boolean);
    parts.push(
      `${address.City}${address.Town}${address.Road}${address.Lane ?? ''}${address.Alley ?? ''}` +
        [...new Set(numbers)].join('–'),
    );
  }
  if (location.Place?.POI) parts.push(location.Place.POI);
  if (location.Other) parts.push(location.Other);
  return (
    parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join('; ') || undefined
  );
}
