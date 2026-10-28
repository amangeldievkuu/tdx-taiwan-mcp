import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrafficCCTVs, TrafficCMSLives, TrafficCMSs, TrafficRoadSection } from 'tdx-taiwan';
import { z } from 'zod';
import { CITIES } from '../core/cities.js';
import type { ToolContext } from '../core/context.js';
import { arrayOf, HEADING } from '../core/format.js';
import { haversine, type LatLon } from '../core/geo.js';
import { search } from '../core/names.js';
import { list } from '../core/respond.js';
import { limit, radius, take } from '../core/schemas.js';
import { defineTool } from '../core/tool.js';
import {
  keyword,
  label,
  latitude,
  longitude,
  network,
  type Network,
  networkOf,
  pointArg,
} from './traffic.js';

/** Every city: TDX answers the ones without cameras or signs with a 400 naming the others. */
const ALL_CITIES = Object.keys(CITIES);
const SIGN_MESSAGE: Record<number, string> = {
  1: 'travel time',
  2: 'congestion',
  3: 'incident',
  4: 'roadworks',
  5: 'parking',
  6: 'notice',
  7: 'other',
};

const direction = z
  .enum(['N', 'S', 'E', 'W'])
  .optional()
  .describe('Only devices facing traffic heading this way (S also matches SE and SW).');

/** What cameras and signs share: where they are on which road. */
interface Placed {
  road: string | undefined;
  at: string | undefined;
  heading: string | undefined;
  direction: string | undefined;
  mile: number;
  position: LatLon | undefined;
}

export function registerTrafficDeviceTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'traffic_cameras', {
    title: 'Traffic cameras',
    description:
      'Live traffic cameras on the national freeways, provincial highways or a city’s roads, ' +
      'by road, place or distance, with the link to each live stream (open it to watch; TDX ' +
      'gives no still images). Example: network "freeway", keyword "林口"; or network ' +
      '"Taipei", lat 25.0478, lon 121.517.',
    input: {
      network,
      keyword,
      direction,
      lat: latitude,
      lon: longitude,
      radiusMeters: radius(2000, 20_000),
      limit: limit(10, 'cameras'),
    },
    run: async (args) => {
      const net = networkOf(args.network, ALL_CITIES, 'cameras');
      const origin = pointArg(args.lat, args.lon);
      const { CCTVs: cameras } = await cctvsOf(ctx, net);
      const rows = arrayOf(cameras).map((c) => ({
        ...placed(c, c.LocationMile, c.RoadSection, c.SurveillanceDescription),
        stream: c.VideoStreamURL || undefined,
        snapshot: c.VideoImageURL || undefined,
        id: c.CCTVID,
      }));
      const near = { ...args, radiusMeters: args.radiusMeters ?? 2000 };
      const items = nearAndNamed(rows, near, origin).map(({ row, distance }) => ({
        road: row.road,
        at: row.at,
        direction: row.direction,
        stream: row.stream,
        snapshot: row.snapshot,
        id: row.id,
        lat: row.position?.lat,
        lon: row.position?.lon,
        distanceMeters: distance === undefined ? undefined : Math.round(distance),
      }));
      return list(items, take(ctx, args.limit, 10), {
        network: label(net),
        note: items.length ? undefined : 'No camera matches.',
      });
    },
  });

  defineTool(server, 'traffic_signs', {
    title: 'Road message signs',
    description:
      'What the changeable message signs over the national freeways, provincial highways or a ' +
      'city’s roads show right now: travel times to the next interchanges, congestion, ' +
      'incidents and roadworks warnings. Example: network "freeway", keyword "汐止", ' +
      'direction "S".',
    input: {
      network,
      keyword,
      direction,
      lat: latitude,
      lon: longitude,
      radiusMeters: radius(5000, 50_000),
      limit: limit(15, 'signs'),
    },
    run: async (args) => {
      const net = networkOf(args.network, ALL_CITIES, 'message signs');
      const origin = pointArg(args.lat, args.lon);
      const [signs, live] = await cmsOf(ctx, net);
      const signById = new Map(arrayOf(signs?.CMSs).map((s) => [s.CMSID, s]));
      const rows = arrayOf(live.CMSLives).flatMap((l) => {
        if (l.MessageStatus === 0) return [];
        const messages = l.Messages.flatMap((m) => {
          // Freeway signs pad with runs of half- and full-width spaces; an idle highway sign
          // sends a single " ".
          const text = m.Text?.replace(/[\s\u3000]+/g, ' ').trim();
          if (!text) return [];
          return [{ text, type: m.Type === undefined ? undefined : SIGN_MESSAGE[m.Type] }];
        });
        if (!messages.length) return [];
        const sign = signById.get(l.CMSID);
        return [
          {
            ...(sign
              ? placed(sign, sign.LocationMile, sign.RoadSection, undefined)
              : {
                  road: undefined,
                  at: undefined,
                  heading: undefined,
                  direction: undefined,
                  mile: Infinity,
                  position: undefined,
                }),
            id: l.CMSID,
            messages,
            updated: l.DataCollectTime,
          },
        ];
      });
      const searchable = rows.map((r) => ({ ...r, text: r.messages.map((m) => m.text).join(' ') }));
      const near = { ...args, radiusMeters: args.radiusMeters ?? 5000 };
      const items = nearAndNamed(searchable, near, origin, (r) => [r.text]).map(
        ({ row, distance }) => ({
          road: row.road,
          at: row.at,
          direction: row.direction,
          messages: row.messages,
          id: row.id,
          lat: row.position?.lat,
          lon: row.position?.lon,
          distanceMeters: distance === undefined ? undefined : Math.round(distance),
          updated: row.updated,
        }),
      );
      return list(items, take(ctx, args.limit, 15), {
        network: label(net),
        note: items.length ? undefined : 'No sign shows a message that matches.',
      });
    },
  });
}

function cctvsOf(ctx: ToolContext, net: Network): Promise<TrafficCCTVs> {
  const traffic = ctx.tdx.traffic;
  return net.kind === 'city' ? traffic.cctvs(net.city) : traffic[net.kind].cctvs();
}

/** The signs (optional: only where they are) and what they show. */
function cmsOf(
  ctx: ToolContext,
  net: Network,
): Promise<[TrafficCMSs | undefined, TrafficCMSLives]> {
  const traffic = ctx.tdx.traffic;
  if (net.kind === 'city') {
    return Promise.all([traffic.cms(net.city).catch(() => undefined), traffic.cmsLive(net.city)]);
  }
  const road = traffic[net.kind];
  return Promise.all([road.cms().catch(() => undefined), road.cmsLive()]);
}

/** Road, place and position of a camera or sign. */
function placed(
  device: {
    RoadName?: string;
    RoadDirection?: string;
    PositionLat: number;
    PositionLon: number;
  },
  mile: string | undefined,
  section: TrafficRoadSection | undefined,
  description: string | undefined,
): Placed {
  const between = [section?.Start, section?.End].filter(Boolean).join('–');
  return {
    road: device.RoadName || undefined,
    at: [mile, between || description].filter(Boolean).join(' ') || undefined,
    heading: device.RoadDirection,
    direction: device.RoadDirection
      ? (HEADING[device.RoadDirection] ?? device.RoadDirection)
      : undefined,
    mile: kilometres(mile),
    position: { lat: device.PositionLat, lon: device.PositionLon },
  };
}

/** `36K+525` as 36.525, to sort along a road; `Infinity` when there is none. */
function kilometres(mile: string | undefined): number {
  const match = /^(\d+)\s*[Kk]\s*\+\s*(\d+)/.exec(mile ?? '');
  return match ? Number(match[1]) + Number(match[2]) / 1000 : Infinity;
}

/**
 * Devices filtered by direction, distance and keyword (road, place and `extra` names), sorted
 * by distance from `origin`, else by road and mileage.
 */
function nearAndNamed<T extends Placed>(
  rows: readonly T[],
  args: { keyword?: string; direction?: string; radiusMeters: number },
  origin: LatLon | undefined,
  extra: (row: T) => Array<string | undefined> = () => [],
): Array<{ row: T; distance: number | undefined }> {
  let kept = rows
    .filter((r) => !args.direction || r.heading?.startsWith(args.direction))
    .map((row) => ({
      row,
      distance: origin && row.position ? haversine(origin, row.position) : undefined,
    }))
    .filter(({ distance }) => !origin || (distance !== undefined && distance <= args.radiusMeters));
  if (args.keyword) {
    kept = search(kept, ({ row }) => [row.road, row.at, ...extra(row)], args.keyword);
  }
  return origin
    ? kept.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    : args.keyword
      ? kept
      : kept.sort(
          (a, b) => (a.row.road ?? '').localeCompare(b.row.road ?? '') || a.row.mile - b.row.mile,
        );
}
