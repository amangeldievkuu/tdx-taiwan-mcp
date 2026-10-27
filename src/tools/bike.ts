import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BikeAvailability, BikeCity, BikeStation } from 'tdx-taiwan';
import { z } from 'zod';
import { normalizeCity } from '../core/cities.js';
import type { ToolContext } from '../core/context.js';
import { type AnyName, name } from '../core/format.js';
import { nearest, pointOf } from '../core/geo.js';
import { search } from '../core/names.js';
import { list } from '../core/respond.js';
import { city, lat, limit, lon, radius, take } from '../core/schemas.js';
import { defineTool } from '../core/tool.js';

const BIKE_CITIES = [
  'Taipei',
  'NewTaipei',
  'Taoyuan',
  'Taichung',
  'Tainan',
  'Kaohsiung',
  'Hsinchu',
  'HsinchuCounty',
  'MiaoliCounty',
  'ChanghuaCounty',
  'YunlinCounty',
  'Chiayi',
  'ChiayiCounty',
  'PingtungCounty',
  'TaitungCounty',
] as const satisfies readonly BikeCity[];

const SERVICE_TYPE: Record<number, string> = { 1: 'YouBike1.0', 2: 'YouBike2.0', 3: 'Moovo' };
const SERVICE_STATUS: Record<number, string> = {
  0: 'out of service',
  1: 'operating',
  2: 'suspended',
};

/** `want` options: a bike to rent, an empty dock to return one, or either. */
const want = z
  .enum(['bike', 'dock', 'any'])
  .optional()
  .describe(
    'Only stations that are operating and have a bike to rent ("bike", default) or an empty ' +
      'dock to return one ("dock"); "any" lists every station.',
  );

interface Row {
  station: BikeStation;
  live: BikeAvailability | undefined;
}

export function registerBikeTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'youbike_nearby', {
    title: 'Nearest YouBike stations',
    description:
      'YouBike / Moovo stations nearest to a coordinate, with live bikes (regular and e-bike) ' +
      'and empty docks, nearest first. Example: lat 25.0478, lon 121.517, city "Taipei".',
    input: {
      lat,
      lon,
      city: city(BIKE_CITIES),
      want,
      radiusMeters: radius(1000, 5000),
      limit: limit(5, 'stations'),
    },
    run: async (args) => {
      const cityCode = normalizeCity(args.city);
      const rows = (await bikeRows(ctx, cityCode)).filter(wanted(args.want));
      const found = nearest(rows, (r) => pointOf(r.station.StationPosition), args, {
        limit: rows.length,
        maxMeters: args.radiusMeters ?? 1000,
      });
      const items = found.map(({ item, distance }) => ({
        distanceMeters: Math.round(distance),
        ...describeRow(item),
      }));
      return list(items, take(ctx, args.limit, 5), { city: cityCode });
    },
  });

  defineTool(server, 'youbike_station', {
    title: 'Find YouBike stations by name',
    description:
      'YouBike / Moovo stations whose name or address contains a keyword (Chinese or English), ' +
      'with live bikes and empty docks. Example: city "Taipei", keyword "臺北車站".',
    input: {
      city: city(BIKE_CITIES),
      keyword: z
        .string()
        .trim()
        .min(1)
        .describe('Part of the station name or address, e.g. "市政府" or "Taipei City Hall".'),
      want: want.describe('Same as in youbike_nearby, but defaults to "any".'),
      limit: limit(10, 'stations'),
    },
    run: async (args) => {
      const cityCode = normalizeCity(args.city);
      const rows = (await bikeRows(ctx, cityCode)).filter(wanted(args.want ?? 'any'));
      const found = search(
        rows,
        ({ station: s }) => [
          stationName(s.StationName?.Zh_tw),
          stationName(s.StationName?.En),
          s.StationAddress?.Zh_tw,
          s.StationAddress?.En,
        ],
        args.keyword,
      );
      return list(found.map(describeRow), take(ctx, args.limit, 10), { city: cityCode });
    },
  });
}

/** Stations joined with their live availability (both lists are cached by the client). */
async function bikeRows(ctx: ToolContext, cityCode: string): Promise<Row[]> {
  const [stations, availability] = await Promise.all([
    ctx.tdx.bike.stations(cityCode),
    ctx.tdx.bike.availability(cityCode),
  ]);
  const live = new Map(availability.map((a) => [a.StationUID, a]));
  return stations.map((station) => ({ station, live: live.get(station.StationUID) }));
}

function wanted(mode: 'bike' | 'dock' | 'any' = 'bike') {
  return ({ live }: Row): boolean => {
    if (mode === 'any') return true;
    if (live?.ServiceStatus !== 1) return false;
    return mode === 'bike'
      ? (live.AvailableRentBikes ?? 0) > 0
      : (live.AvailableReturnBikes ?? 0) > 0;
  };
}

function describeRow({ station, live }: Row) {
  const detail = live?.AvailableRentBikesDetail;
  return {
    name: name(cleanName(station.StationName)),
    address: name(station.StationAddress),
    stationUID: station.StationUID ?? undefined,
    type: SERVICE_TYPE[station.ServiceType ?? live?.ServiceType ?? 0],
    status: live?.ServiceStatus === undefined ? 'no live data' : SERVICE_STATUS[live.ServiceStatus],
    bikes: live?.AvailableRentBikes ?? undefined,
    regularBikes: detail?.GeneralBikes,
    eBikes: detail?.ElectricBikes,
    emptyDocks: live?.AvailableReturnBikes ?? undefined,
    capacity: station.BikesCapacity ?? undefined,
    lat: station.StationPosition?.PositionLat ?? undefined,
    lon: station.StationPosition?.PositionLon ?? undefined,
    updated: live?.SrcUpdateTime ?? live?.UpdateTime,
  };
}

/** Station names carry the system as a prefix: `YouBike2.0_捷運科技大樓站`. */
function stationName(value: string | null | undefined): string | undefined {
  return value?.replace(/^YouBike\d\.\d_/i, '');
}

function cleanName(value: AnyName | null | undefined): AnyName | undefined {
  if (!value) return undefined;
  return { Zh_tw: stationName(value.Zh_tw), En: stationName(value.En) };
}
