import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TraTrainInfo } from 'tdx-taiwan';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { fareTable } from '../core/fares.js';
import { name } from '../core/format.js';
import { list, ok } from '../core/respond.js';
import { after, date, limit, take } from '../core/schemas.js';
import { duration, hhmm, startTime, taipeiNow } from '../core/time.js';
import { defineTool } from '../core/tool.js';
import { findStation, type RailStation } from './rail-stations.js';

/** 車種簡碼 (`TrainTypeCode`, and `TrainType` in fares). */
const TRAIN_TYPE: Record<string, string> = {
  1: '太魯閣 Taroko',
  2: '普悠瑪 Puyuma',
  3: '自強 Tze-Chiang',
  4: '莒光 Chu-Kuang',
  5: '復興 Fu-Hsing',
  6: '區間 Local',
  7: '普快 Ordinary',
  10: '區間快 Fast Local',
  11: '自強(3000) Tze-Chiang 3000',
};
const TRIP_LINE: Record<number, string> = {
  1: 'mountain line (山線)',
  2: 'coast line (海線)',
  3: '成追線',
};
const RUNNING: Record<number, string> = { 0: 'on time', 1: 'delayed', 2: 'cancelled' };
const AT_STATION: Record<number, string> = { 0: 'arriving at', 1: 'at', 2: 'departed from' };
const FARE_CLASS = { 8: 'group', 9: 'militaryPolice' };

const station = (role: string) =>
  z
    .string()
    .trim()
    .min(1)
    .describe(`${role} TRA station: name (臺北, 台中, Hualien) or station ID (1000).`);
const trainNo = z
  .string()
  .trim()
  .regex(/^\d{1,4}$/, 'A TRA train number has up to 4 digits')
  .describe('Train number, e.g. "123".');

export function registerTraTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'tra_timetable', {
    title: 'Taiwan Railway timetable',
    description:
      'TRA (臺鐵) trains from one station to another on a day: train type, departure, arrival, ' +
      'travel time, from now on for today. TDX covers about two months ahead. Example: from ' +
      '"臺北", to "花蓮", date "2026-10-23".',
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
      const { TrainTimetables } = await ctx.tdx.tra.timetable(from.id, to.id, day);
      const items = (TrainTimetables ?? [])
        .flatMap((t) => {
          const departs = t.StopTimes.find((s) => s.StationID === from.id)?.DepartureTime;
          const arrives = t.StopTimes.find((s) => s.StationID === to.id)?.ArrivalTime;
          if (!departs || !arrives) return [];
          return [
            {
              trainNo: t.TrainInfo.TrainNo,
              type: trainType(t.TrainInfo),
              departs,
              arrives,
              duration: duration(departs, arrives),
              headsign: t.TrainInfo.TripHeadSign || undefined,
              ...extras(t.TrainInfo),
            },
          ];
        })
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

  defineTool(server, 'tra_live_board', {
    title: 'Taiwan Railway station live board',
    description:
      'Trains about to arrive at or leave a TRA station now, with delay and platform. Only ' +
      'imminent trains are listed; use tra_timetable for later ones. Example: station "板橋".',
    input: { station: station('The') },
    run: async (args) => {
      const [stop] = await findStation(ctx, 'TRA', args.station);
      const board = await ctx.tdx.tra.liveBoard(stop.id);
      const items = board.StationLiveBoards.map((b) => ({
        trainNo: b.TrainNo,
        type: trainType(b),
        to: name(b.EndingStationName),
        arrives: hhmm(b.ScheduleArrivalTime),
        departs: hhmm(b.ScheduleDepartureTime),
        delayMinutes: b.DelayTime,
        status: b.RunningStatus == null ? undefined : RUNNING[b.RunningStatus],
        platform: b.Platform || undefined,
        line: b.TripLine ? TRIP_LINE[b.TripLine] : undefined,
      })).sort((a, b) => (a.departs ?? '').localeCompare(b.departs ?? ''));
      return list(items, ctx.maxItems, {
        station: name(stop.name),
        updated: board.SrcUpdateTime,
        note: items.length ? undefined : 'No train is due at this station in the next few minutes.',
      });
    },
  });

  defineTool(server, 'tra_train', {
    title: 'Taiwan Railway train today',
    description:
      'One TRA train today: its stops with times, and where it is now and how late it runs. ' +
      'Example: trainNo "123".',
    input: { trainNo },
    run: async (args) => {
      const [timetable, live] = await Promise.all([
        ctx.tdx.tra.trainTimetable(args.trainNo),
        ctx.tdx.tra.trainLiveBoard(args.trainNo),
      ]);
      const [train] = timetable.TrainTimetables ?? [];
      if (!train) throw new ToolInputError(`No TRA train ${args.trainNo} runs today.`);
      const info = train.TrainInfo;
      const [now] = live.TrainLiveBoards;
      return ok({
        trainNo: info.TrainNo,
        type: trainType(info),
        from: name(info.StartingStationName),
        to: name(info.EndingStationName),
        ...extras(info),
        live: now
          ? {
              position: `${AT_STATION[now.TrainStationStatus ?? 1] ?? 'at'} ${name(now.StationName)}`,
              delayMinutes: now.DelayTime,
              updated: now.UpdateTime,
            }
          : 'not running now',
        stops: [...train.StopTimes]
          .sort((a, b) => a.StopSequence - b.StopSequence)
          .map((s) => ({
            station: name(s.StationName),
            arrives: s.ArrivalTime,
            departs: s.DepartureTime,
            cancelled: s.SuspendedFlag === 1 ? true : undefined,
          })),
      });
    },
  });

  defineTool(server, 'tra_fare', {
    title: 'Taiwan Railway fares',
    description:
      'TRA single-journey fares between two stations in NT$ per train type (自強, 莒光, 區間, ...) ' +
      'and passenger type, with the distance. Example: from "臺北", to "高雄".',
    input: { from: station('Departure'), to: station('Arrival') },
    run: async (args) => {
      const [from, to] = await stations(ctx, args.from, args.to);
      const { ODFares } = await ctx.tdx.tra.odFare(from.id, to.id);
      // TDX lists each train type once per direction round the island; keep the shorter way.
      const shortest = new Map<number, (typeof ODFares)[number]>();
      for (const fare of ODFares) {
        const kept = shortest.get(fare.TrainType);
        if (!kept || (fare.TravelDistance ?? Infinity) < (kept.TravelDistance ?? Infinity)) {
          shortest.set(fare.TrainType, fare);
        }
      }
      const items = [...shortest.values()]
        .sort((a, b) => a.TrainType - b.TrainType)
        .map((f) => ({
          trainType: TRAIN_TYPE[f.TrainType] ?? `type ${f.TrainType}`,
          distanceKm: f.TravelDistance ?? undefined,
          prices: fareTable(f.Fares, FARE_CLASS),
        }));
      return list(items, ctx.maxItems, { from: name(from.name), to: name(to.name) });
    },
  });
}

function trainType(info: {
  TrainTypeCode?: string | null;
  TrainTypeName: { Zh_tw?: string | null; En?: string | null };
}): string | undefined {
  return (
    (info.TrainTypeCode ? TRAIN_TYPE[info.TrainTypeCode] : undefined) ?? name(info.TrainTypeName)
  );
}

/** Facts worth a passenger's attention; ordinary values are left out. */
function extras(info: TraTrainInfo) {
  return {
    line: TRIP_LINE[info.TripLine ?? 0],
    bikes: info.BikeFlag === 1 ? true : undefined,
    wheelchair: info.WheelChairFlag === 1 ? true : undefined,
    cancelled: info.SuspendedFlag === 1 ? true : info.SuspendedFlag === 2 ? 'partly' : undefined,
    // Most notes start with 每日行駛。 (runs daily), which the timetable already implies.
    note: info.Note?.replace(/^每日行駛。\s*/, '').trim() || undefined,
  };
}

async function stations(
  ctx: ToolContext,
  from: string,
  to: string,
): Promise<[RailStation, RailStation]> {
  const [[origin], [destination]] = await Promise.all([
    findStation(ctx, 'TRA', from),
    findStation(ctx, 'TRA', to),
  ]);
  if (origin.id === destination.id) {
    throw new ToolInputError(`"${from}" and "${to}" are the same TRA station.`);
  }
  return [origin, destination];
}
