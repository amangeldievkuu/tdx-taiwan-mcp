import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { fareTable } from '../core/fares.js';
import { arrayOf, name } from '../core/format.js';
import { list } from '../core/respond.js';
import { duration } from '../core/time.js';
import { defineTool } from '../core/tool.js';
import { findStation } from './rail-stations.js';

const station = (role: string) =>
  z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(`${role} AFR station: name (嘉義, 奮起湖, Alishan) or station ID (360).`);

export function registerAfrTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'afr_fare', {
    title: 'Alishan Forest Railway fares',
    description:
      'Alishan Forest Railway (阿里山林業鐵路) single-journey fares in NT$ between two stations, ' +
      'per train type and passenger type, with the distance. Example: from "嘉義", to "奮起湖".',
    input: {
      from: station('Departure').unwrap(),
      to: station('Arrival').unwrap(),
    },
    run: async (args) => {
      const [[from], [to]] = await Promise.all([
        findStation(ctx, 'AFR', args.from),
        findStation(ctx, 'AFR', args.to),
      ]);
      if (from.id === to.id) {
        throw new ToolInputError(`"${args.from}" and "${args.to}" are the same AFR station.`);
      }
      const [fares, types] = await Promise.all([
        ctx.tdx.afr.odFare(from.id, to.id),
        ctx.tdx.afr.trainTypes().catch(() => undefined),
      ]);
      const typeName = new Map(
        arrayOf(types?.TrainTypes).map((t) => [String(t.TrainTypeCode), name(t.TrainTypeName)]),
      );
      const items = arrayOf(fares.ODFares).map((f) => ({
        trainType: typeName.get(String(f.TrainType)) ?? `type ${f.TrainType}`,
        distanceKm: f.TravelDistance ?? undefined,
        // One cabin per train type: the cabin codes would read as TRA's.
        prices: fareTable(f.Fares.map((fare) => ({ ...fare, CabinClass: undefined }))),
      }));
      return list(items, ctx.maxItems, {
        from: name(from.name),
        to: name(to.name),
        note: items.length ? undefined : 'TDX has no fare between these stations.',
      });
    },
  });

  defineTool(server, 'afr_timetable', {
    title: 'Alishan Forest Railway timetable',
    description:
      'The regular timetable of the Alishan Forest Railway (阿里山林業鐵路): every train, or the ' +
      'trains from one station to another with their times. Services change with the season ' +
      'and weather; the result says when to check the official site. Example: from "嘉義", ' +
      'to "奮起湖".',
    input: { from: station('Departure'), to: station('Arrival') },
    run: async (args) => {
      const [from, to] = await Promise.all([
        args.from ? findStation(ctx, 'AFR', args.from) : undefined,
        args.to ? findStation(ctx, 'AFR', args.to) : undefined,
      ]);
      if (from && to && from[0].id === to[0].id) {
        throw new ToolInputError(`"${args.from}" and "${args.to}" are the same AFR station.`);
      }
      const timetable = await ctx.tdx.afr.generalTimetable();
      const items = timetable.TrainTimetables.flatMap((t) => {
        const stops = [...t.StopTimes].sort((a, b) => a.StopSequence - b.StopSequence);
        const i = from ? stops.findIndex((s) => s.StationID === from[0].id) : 0;
        const j = to ? stops.findIndex((s) => s.StationID === to[0].id) : stops.length - 1;
        const origin = stops[i];
        const destination = stops[j];
        if (i < 0 || j < 0 || i >= j || !origin || !destination) return [];
        const notice = t.ServiceDay.ServiceTag?.trim();
        return [
          {
            trainNo: t.TrainInfo.TrainNo,
            headsign: t.TrainInfo.TripHeadSign?.trim() || undefined,
            from: name(origin.StationName),
            departs: origin.DepartureTime,
            to: name(destination.StationName),
            arrives: destination.ArrivalTime,
            duration: duration(origin.DepartureTime, destination.ArrivalTime),
            note: [notice, t.TrainInfo.Note?.trim()].filter(Boolean).join('; ') || undefined,
          },
        ];
      }).sort((a, b) => a.departs.localeCompare(b.departs));
      return list(items, ctx.maxItems, {
        effective: timetable.EffectiveDate.slice(0, 10),
        note: items.length
          ? 'Regular timetable; check https://afrch.forest.gov.tw for the trains running on a given day.'
          : 'No regular train runs between these stations in that direction.',
      });
    },
  });
}
