import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { fareTable } from '../core/fares.js';
import { name } from '../core/format.js';
import { list, ok } from '../core/respond.js';
import { after, date, limit, take } from '../core/schemas.js';
import { duration, startTime, taipeiNow } from '../core/time.js';
import { defineTool } from '../core/tool.js';
import { findStation, type RailStation } from './rail-stations.js';

const DIRECTION: Record<number, string> = { 0: 'southbound', 1: 'northbound' };
const SEATS: Record<string, string> = { O: 'available', L: 'limited', X: 'sold out' };
const FARE_CLASS = { 8: 'militaryPolice', 9: 'statutoryDiscount' };

const station = (role: string) =>
  z
    .string()
    .trim()
    .min(1)
    .describe(`${role} THSR station: name (台北, Zuoying, 新竹) or station ID (1000).`);

export function registerThsrTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'thsr_timetable', {
    title: 'High speed rail timetable',
    description:
      'THSR (高鐵) trains from one station to another on a day, with departure, arrival and ' +
      'travel time, from now on for today. TDX covers about four weeks ahead. Example: from ' +
      '"台北", to "左營", date "2026-10-23", after "08:00".',
    input: {
      from: station('Departure'),
      to: station('Arrival'),
      date,
      after,
      limit: limit(10, 'trains'),
    },
    run: async (args) => {
      const [from, to] = await stations(ctx, args.from, args.to);
      const day = args.date ?? taipeiNow().date;
      const start = startTime(day, args.after);
      const trains = await ctx.tdx.thsr.timetable(from.id, to.id, day);
      const items = trains
        .map((t) => ({
          trainNo: t.DailyTrainInfo.TrainNo,
          departs: t.OriginStopTime.DepartureTime,
          arrives: t.DestinationStopTime.ArrivalTime ?? undefined,
          duration: duration(t.OriginStopTime.DepartureTime, t.DestinationStopTime.ArrivalTime),
          direction: DIRECTION[t.DailyTrainInfo.Direction],
          runs: `${t.DailyTrainInfo.StartingStationName?.Zh_tw ?? '?'} → ${t.DailyTrainInfo.EndingStationName?.Zh_tw ?? '?'}`,
        }))
        .filter((t) => t.departs >= start)
        .sort((a, b) => a.departs.localeCompare(b.departs));
      return list(items, take(ctx, args.limit, 10), {
        from: name(from.name),
        to: name(to.name),
        date: day,
        after: start,
      });
    },
  });

  defineTool(server, 'thsr_seats', {
    title: 'High speed rail seat availability',
    description:
      'Reserved-seat availability (available, limited, sold out) in standard and business ' +
      'class for THSR trains between two stations, with their times. Updated about every 10 ' +
      'minutes. Example: from "台北", to "台中".',
    input: {
      from: station('Departure'),
      to: station('Arrival'),
      date,
      after,
      limit: limit(10, 'trains'),
    },
    run: async (args) => {
      const [from, to] = await stations(ctx, args.from, args.to);
      const day = args.date ?? taipeiNow().date;
      const start = startTime(day, args.after);
      const [seats, trains] = await Promise.all([
        ctx.tdx.thsr.odSeatStatus(from.id, to.id, day),
        ctx.tdx.thsr.timetable(from.id, to.id, day),
      ]);
      const times = new Map(trains.map((t) => [t.DailyTrainInfo.TrainNo, t]));
      const items = seats.AvailableSeats.map((s) => {
        const t = times.get(s.TrainNo);
        return {
          trainNo: s.TrainNo,
          departs: t?.OriginStopTime.DepartureTime,
          arrives: t?.DestinationStopTime.ArrivalTime,
          standard: SEATS[s.StandardSeatStatus] ?? s.StandardSeatStatus,
          business: SEATS[s.BusinessSeatStatus] ?? s.BusinessSeatStatus,
        };
      })
        .filter((s) => s.departs === undefined || s.departs >= start)
        .sort((a, b) => (a.departs ?? '').localeCompare(b.departs ?? ''));
      return list(items, take(ctx, args.limit, 10), {
        from: name(from.name),
        to: name(to.name),
        date: day,
        after: start,
        updated: seats.SrcUpdateTime ?? seats.UpdateTime ?? undefined,
        note: items.length
          ? undefined
          : 'No seat data: there may be no more trains on this day, or the date is outside the ' +
            'booking window.',
      });
    },
  });

  defineTool(server, 'thsr_fare', {
    title: 'High speed rail fares',
    description:
      'THSR single-journey fares between two stations in NT$, per car (standard, business, ' +
      'non-reserved) and passenger type (adult, child, senior, ...). Example: from "台北", to "台南".',
    input: { from: station('Departure'), to: station('Arrival') },
    run: async (args) => {
      const [from, to] = await stations(ctx, args.from, args.to);
      const [fare] = await ctx.tdx.thsr.odFare(from.id, to.id);
      if (!fare) throw new ToolInputError(`TDX has no THSR fare from ${args.from} to ${args.to}.`);
      return ok({
        from: name(from.name),
        to: name(to.name),
        prices: fareTable(fare.Fares, FARE_CLASS),
      });
    },
  });

  defineTool(server, 'thsr_train', {
    title: 'High speed rail train stops',
    description:
      'Every stop of one THSR train on a day, with arrival and departure times. Example: ' +
      'trainNo "0803" (or "803").',
    input: {
      trainNo: z
        .string()
        .trim()
        .regex(/^\d{1,4}$/, 'A THSR train number has up to 4 digits')
        .describe('Train number.'),
      date,
    },
    run: async (args) => {
      const trainNo = args.trainNo.padStart(4, '0');
      const day = args.date ?? taipeiNow().date;
      const [train] = await ctx.tdx.thsr.trainTimetable(trainNo, day);
      if (!train) throw new ToolInputError(`No THSR train ${trainNo} runs on ${day}.`);
      const info = train.DailyTrainInfo;
      return ok({
        trainNo,
        date: day,
        direction: DIRECTION[info.Direction],
        from: name(info.StartingStationName),
        to: name(info.EndingStationName),
        stops: [...train.StopTimes]
          .sort((a, b) => a.StopSequence - b.StopSequence)
          .map((s) => ({
            station: name(s.StationName),
            arrives: s.ArrivalTime,
            departs: s.DepartureTime,
          })),
      });
    },
  });
}

async function stations(
  ctx: ToolContext,
  from: string,
  to: string,
): Promise<[RailStation, RailStation]> {
  const [[origin], [destination]] = await Promise.all([
    findStation(ctx, 'THSR', from),
    findStation(ctx, 'THSR', to),
  ]);
  if (origin.id === destination.id) {
    throw new ToolInputError(`"${from}" and "${to}" are the same THSR station.`);
  }
  return [origin, destination];
}
