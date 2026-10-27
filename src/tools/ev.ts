import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  EvConnectors,
  EvLiveStatus,
  EvLiveStatuses,
  EvLocation,
  EvStation,
  EvStations,
} from 'tdx-taiwan';
import { z } from 'zod';
import { CITIES, normalizeCity } from '../core/cities.js';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { arrayOf, name } from '../core/format.js';
import { nearest } from '../core/geo.js';
import { list } from '../core/respond.js';
import { lat, limit, lon, radius, take } from '../core/schemas.js';
import { defineTool } from '../core/tool.js';

const CONNECTOR_TYPES = { CCS1: 1, CCS2: 2, CHAdeMO: 3, Tesla: 4, J1772: 5, Type2: 6 } as const;
type ConnectorName = keyof typeof CONNECTOR_TYPES;
const CONNECTOR_TYPE = Object.fromEntries(
  Object.entries(CONNECTOR_TYPES).map(([word, code]) => [code, word]),
) as Record<number, string>;
const POWER: Record<number, string> = { 1: 'AC', 2: 'DC' };
/** Every city but Lienchiang has an EV feed. */
const EV_CITIES = Object.keys(CITIES).filter((c) => c !== 'LienchiangCounty');
const FREEWAY = 'freeway';

export function registerEvTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'ev_charger_nearby', {
    title: 'Nearest EV chargers',
    description:
      'EV charging stations nearest to a coordinate, with their connectors (type, AC/DC, ' +
      'power) and how many are free, in use or out of order right now, plus opening hours and ' +
      'prices. Use city "freeway" for the freeway service areas. Example: lat 25.0478, lon ' +
      '121.517, city "Taipei", connector "CCS2".',
    input: {
      lat,
      lon,
      city: z
        .string()
        .trim()
        .min(1)
        .describe(
          `City: a TDX code (${EV_CITIES.slice(0, 6).join(', ')}, ...) or its Chinese name ` +
            '(臺北市, 新北市, ...), or "freeway" for the freeway service areas.',
        ),
      connector: z
        .enum(Object.keys(CONNECTOR_TYPES) as [ConnectorName, ...ConnectorName[]])
        .optional()
        .describe(
          'Only stations with this connector: CCS1, CCS2, CHAdeMO, Tesla (TPC), J1772 (Type 1) ' +
            'or Type2 (Mennekes).',
        ),
      power: z.enum(['AC', 'DC']).optional().describe('Only AC (slow) or DC (fast) charging.'),
      want: z
        .enum(['free', 'any'])
        .optional()
        .describe(
          '"free" (default): only stations with a free connector of the wanted kind right now; ' +
            '"any": every station.',
        ),
      radiusMeters: radius(2000, 50_000),
      limit: limit(5, 'stations'),
    },
    run: async (args) => {
      const area = evArea(args.city);
      const [stations, connectors, statuses] = await evFeeds(ctx, area);
      const stationList = arrayOf(stations.Stations);
      const stationIds = new Set(stationList.map((s) => s.StationID));
      // A status names its station through its connector; its own StationID can use another
      // scheme. Fall back to it only when the connector list lacks the connector.
      const connectorStation = new Map(
        arrayOf(connectors.Connectors).map((c) => [c.ConnectorID, c.StationID]),
      );
      const powerRatings = new Map<string, Set<string>>();
      for (const c of arrayOf(connectors.Connectors)) {
        if (!c.PowerRating) continue;
        const key = `${c.StationID}:${c.Type}:${c.Power}`;
        const ratings = powerRatings.get(key) ?? new Set<string>();
        powerRatings.set(key, ratings.add(c.PowerRating));
      }
      const byStation = new Map<string, EvLiveStatus[]>();
      let unattributed = 0;
      for (const status of arrayOf(statuses.LiveStatuses)) {
        const stationId = connectorStation.get(status.ConnectorID) ?? status.StationID;
        if (!stationIds.has(stationId)) {
          unattributed++;
          continue;
        }
        byStation.set(stationId, [...(byStation.get(stationId) ?? []), status]);
      }

      const type = args.connector ? CONNECTOR_TYPES[args.connector] : undefined;
      const power = args.power === 'AC' ? 1 : args.power === 'DC' ? 2 : undefined;
      const rows = stationList.flatMap((station) => {
        const live = byStation.get(station.StationID) ?? [];
        const summary = summarize(station, live, powerRatings);
        const matching = summary.filter(
          (c) =>
            (type === undefined || c.code === type) &&
            (power === undefined || c.powerCode === power),
        );
        if (!matching.length) return [];
        const free = matching.reduce((n, c) => n + (c.free ?? 0), 0);
        if ((args.want ?? 'free') === 'free' && free === 0) return [];
        return [{ station, summary, live }];
      });
      const found = nearest(
        rows,
        (r) => ({ lat: r.station.PositionLat, lon: r.station.PositionLon }),
        args,
        {
          limit: rows.length,
          maxMeters: args.radiusMeters ?? 2000,
        },
      );
      const items = found.map(({ item: { station, summary, live }, distance }) => ({
        name: name(station.StationName),
        distanceMeters: Math.round(distance),
        address: address(station.Location),
        connectors: summary.map(({ code: _, powerCode: __, ...c }) => c),
        serviceTime: station.ServiceTime || undefined,
        chargingRate: station.ChargingRate || undefined,
        parkingRate: station.ParkingRate || undefined,
        floors: station.Floors || undefined,
        restriction: station.UsageRestriction || undefined,
        id: station.StationID,
        lat: station.PositionLat,
        lon: station.PositionLon,
        updated: live
          .map((s) => s.LastUpdateTime)
          .sort()
          .at(-1),
      }));
      let note: string | undefined;
      if (!items.length && (args.want ?? 'free') === 'free') {
        const inRange = nearest(
          stationList,
          (s) => ({ lat: s.PositionLat, lon: s.PositionLon }),
          args,
          {
            limit: stationList.length,
            maxMeters: args.radiusMeters ?? 2000,
          },
        );
        const dark = inRange.filter(({ item }) => !byStation.has(item.StationID)).length;
        note =
          'No station in range has a free connector of that kind right now (stations in ' +
          `range: ${inRange.length}, without live status: ${dark}). Use want "any" to list them.`;
      }
      return list(items, take(ctx, args.limit, 5), {
        city: area,
        unattributed: unattributed || undefined,
        note,
      });
    },
  });
}

function evArea(input: string): string {
  if (input.trim().toLowerCase() === FREEWAY || input.trim() === '國道') return FREEWAY;
  const code = normalizeCity(input);
  if (!EV_CITIES.includes(code)) {
    throw new ToolInputError(
      `TDX has no EV charging data for "${input}". Use a city (${EV_CITIES.join(', ')}) or "freeway".`,
    );
  }
  return code;
}

function evFeeds(
  ctx: ToolContext,
  area: string,
): Promise<[EvStations, EvConnectors, EvLiveStatuses]> {
  const ev = ctx.tdx.ev;
  if (area === FREEWAY) {
    return Promise.all([ev.freeway.stations(), ev.freeway.connectors(), ev.freeway.liveStatus()]);
  }
  return Promise.all([ev.stations(area), ev.connectors(area), ev.liveStatus(area)]);
}

/**
 * The station's connectors by type and power, with the live counts of the statuses of that
 * type (statuses carry no power, so a type listed twice gets them once).
 */
function summarize(
  station: EvStation,
  live: readonly EvLiveStatus[],
  powerRatings: Map<string, Set<string>>,
) {
  const counted = new Set<number>();
  return arrayOf(station.Connectors).map((c) => {
    const statuses = counted.has(c.Type) ? [] : live.filter((s) => s.ConnectorType === c.Type);
    counted.add(c.Type);
    const count = (status: number) =>
      statuses.length ? statuses.filter((s) => s.ConnectorStatus === status).length : undefined;
    const ratings = powerRatings.get(`${station.StationID}:${c.Type}:${c.Power}`);
    return {
      code: c.Type,
      powerCode: c.Power,
      type: CONNECTOR_TYPE[c.Type] ?? 'other',
      power: POWER[c.Power],
      count: c.Quantity,
      maxPower: ratings ? [...ratings].join(' / ') : undefined,
      free: count(1),
      inUse: count(2),
      outOfOrder: count(3),
    };
  });
}

/** `國道1號 湖口服務區南站`, a street address, a landmark or a road. */
function address(location: EvLocation): string | undefined {
  const { Freeway: freeway, Address: a, Place: place, CityRoad: road } = location;
  if (freeway) return `${freeway.Road} ${freeway.ServiceArea}`;
  if (a) return `${a.City}${a.Town}${a.Road}${a.Lane ?? ''}${a.Alley ?? ''}${a.No ?? ''}`;
  if (place?.POI) return place.POI;
  if (road) return `${road.City}${road.Town}${road.Road}`;
  return undefined;
}
