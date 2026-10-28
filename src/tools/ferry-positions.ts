import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { arrayOf, name } from '../core/format.js';
import { haversine, type LatLon, pointOf } from '../core/geo.js';
import { resolve, search } from '../core/names.js';
import { list } from '../core/respond.js';
import { limit, take } from '../core/schemas.js';
import { defineTool } from '../core/tool.js';

/** AIS navigational status (`NAVSTAT`). */
const NAV_STATUS: Record<number, string> = {
  0: 'under way',
  1: 'at anchor',
  2: 'not under command',
  3: 'restricted manoeuvrability',
  4: 'constrained by draught',
  5: 'moored',
  6: 'aground',
  7: 'fishing',
  8: 'under way (sailing)',
  15: 'not reported',
};
/** Slower than this (knots) counts as stopped: AIS speeds jitter at a berth. */
const MOVING_KNOTS = 1;

export function registerFerryPositionTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'ferry_positions', {
    title: 'Ferry positions',
    description:
      'Where ferries and other passenger vessels around Taiwan are right now (AIS): position, ' +
      'speed, course, status (under way, moored, ...) and the nearest port. Search by vessel ' +
      'name, near a port, or near a point. Positions are not tied to routes, and names are as ' +
      'the ships broadcast them (often English). Example: port "小琉球"; or keyword "TAIMA".',
    input: {
      keyword: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Part of the vessel name, e.g. "TAIMA" or "綠島之星".'),
      port: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Only vessels near this port: name (基隆, 小琉球, 馬公) or port ID (TWKEL).'),
      lat: z.number().min(21).max(27).optional().describe('Latitude, to search near a point.'),
      lon: z.number().min(118).max(123).optional().describe('Longitude, to search near a point.'),
      radiusKm: z
        .number()
        .min(0.5)
        .max(300)
        .optional()
        .describe('Search radius around the port or point, in km (default 10).'),
      moving: z.boolean().optional().describe('Only vessels under way (faster than 1 knot).'),
      limit: limit(20, 'vessels'),
    },
    run: async (args) => {
      if ((args.lat === undefined) !== (args.lon === undefined)) {
        throw new ToolInputError('Give both lat and lon, or neither.');
      }
      const [positions, portList] = await Promise.all([
        ctx.tdx.ship.livePosition(),
        ctx.tdx.ship.ports(),
      ]);
      const ports = arrayOf(portList.Ports).flatMap((p) => {
        const position = pointOf(p.PortPosition);
        return position ? [{ id: p.PortID, name: p.PortName, position }] : [];
      });
      let origin: LatLon | undefined =
        args.lat !== undefined && args.lon !== undefined
          ? { lat: args.lat, lon: args.lon }
          : undefined;
      let near: string | undefined;
      if (args.port) {
        const [port] = resolve(ports, args.port, {
          names: (p) => [p.name.Zh_tw, p.name.En],
          ids: (p) => [p.id],
          label: 'port',
          many: true,
        });
        origin = port.position;
        near = name(port.name) ?? port.id;
      }
      const radiusMeters = (args.radiusKm ?? 10) * 1000;
      const rows = arrayOf(positions.LivePositions).flatMap((v) => {
        const position = pointOf(v.VesselPosition);
        const speed = v.SOG ?? 0;
        if (args.moving && speed <= MOVING_KNOTS) return [];
        const distance = origin && position ? haversine(origin, position) : undefined;
        if (origin && (distance === undefined || distance > radiusMeters)) return [];
        const nearest = position
          ? ports
              .map((p) => ({ port: p, meters: haversine(position, p.position) }))
              .sort((a, b) => a.meters - b.meters)[0]
          : undefined;
        return [
          {
            vessel: name(v.VesselName) ?? `MMSI ${v.MMSI}`,
            status: NAV_STATUS[v.NAVSTAT] ?? 'unknown',
            speedKnots: v.SOG,
            courseDegrees: speed > MOVING_KNOTS ? v.COG : undefined,
            nearPort: nearest
              ? `${name(nearest.port.name) ?? nearest.port.id} (${(nearest.meters / 1000).toFixed(1)} km)`
              : undefined,
            distanceKm: distance === undefined ? undefined : Math.round(distance / 100) / 10,
            lat: position?.lat,
            lon: position?.lon,
            updated: v.GPSTime,
            mmsi: v.MMSI,
            moving: speed > MOVING_KNOTS,
          },
        ];
      });
      const found = args.keyword ? search(rows, (r) => [r.vessel, r.mmsi], args.keyword) : rows;
      const items = (
        args.keyword
          ? found
          : [...found].sort((a, b) =>
              origin
                ? (a.distanceKm ?? 0) - (b.distanceKm ?? 0)
                : Number(b.moving) - Number(a.moving) || a.vessel.localeCompare(b.vessel),
            )
      ).map(({ moving: _, ...item }) => item);
      return list(items, take(ctx, args.limit, 20), {
        near,
        updated: positions.UpdateTime,
        note: items.length
          ? undefined
          : near
            ? `No vessel within ${args.radiusKm ?? 10} km of ${near} reports a position now.`
            : 'No vessel matches.',
      });
    },
  });
}
