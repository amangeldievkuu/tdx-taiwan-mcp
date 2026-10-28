import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TdxClient } from 'tdx-taiwan';
import type { ToolContext } from './core/context.js';
import { registerAfrTools } from './tools/afr.js';
import { registerAirTools } from './tools/air.js';
import { registerBikeTools } from './tools/bike.js';
import { registerBusServiceTools } from './tools/bus-service.js';
import { registerBusTools } from './tools/bus.js';
import { registerEvTools } from './tools/ev.js';
import { registerMetroTools } from './tools/metro.js';
import { registerParkingTools } from './tools/parking.js';
import { registerRailStationTools } from './tools/rail-station.js';
import { registerRailTools } from './tools/rail.js';
import { registerRawTools } from './tools/raw.js';
import { registerShipTools } from './tools/ship.js';
import { registerThsrTools } from './tools/thsr.js';
import { registerTraTools } from './tools/tra.js';
import { registerTrafficTools } from './tools/traffic.js';
import { registerTravelTimeTools } from './tools/travel-time.js';
import { VERSION } from './version.js';

export interface ServerOptions {
  /**
   * The client the tools call. Turn its cache on (`cache: true`): the tools re-read large
   * static lists, such as every YouBike station of a city, on each call.
   */
  tdx: TdxClient;
  /** Upper bound for any tool's `limit`. Default: 200. */
  maxItems?: number;
}

const INSTRUCTIONS = `\
Taiwan transport data from TDX (交通部 Transport Data eXchange): YouBike stations and live
availability; city and intercity bus routes, stops, live arrival times, timetables, alerts and
bus positions; high speed rail (THSR), Taiwan Railway (TRA), metro and Alishan railway
timetables, station departures, exits, live boards, seats, fares and alerts; flights (live
airport boards with weather, flight status, domestic schedules and fares); ferries (timetables
with live status, port live boards, fares, alerts); road traffic (live congestion, incidents and
closures on freeways, highways and city roads); car parks and on-street parking with free
spaces; EV chargers with live connector status.
Cities are TDX codes such as Taipei, NewTaipei, Taoyuan, Taichung, Tainan, Kaohsiung (Chinese
names like 臺北市 work too). Times are Taiwan time (UTC+8). Bus tools need the exact route name;
find it with bus_route_search first, or bus_stops_nearby for the routes at stops near a point;
bus_stop_arrivals shows every route due at one stop. Rail tools take station names in Chinese or
English (台北, Taipei) or station IDs; rail_station_departures lists everything leaving a station.
Airports are IATA codes or names (TPE 桃園, TSA 松山, KNH 金門); flight numbers include the airline
code (CI100). Ferry ports are names (富岡, 綠島, 小琉球); lines run by a county (Penghu inter-island
boats, 旗津, 淡水) need city, e.g. PenghuCounty. Road tools take a network: freeway, highway or a
city; traffic_travel_time takes freeway interchange names in Chinese (林口, 新竹). Use tdx_get only
when no other tool covers the data.
Cite the data as 資料來源：交通部 TDX 運輸資料流通服務平臺.`;

/** An MCP server exposing the TDX tools. Connect it to any transport. */
export function createServer({ tdx, maxItems = 200 }: ServerOptions): McpServer {
  const server = new McpServer(
    { name: 'tdx-taiwan-mcp', title: 'Taiwan TDX transport', version: VERSION },
    { instructions: INSTRUCTIONS },
  );
  const ctx: ToolContext = { tdx, maxItems };
  registerBikeTools(server, ctx);
  registerBusTools(server, ctx);
  registerBusServiceTools(server, ctx);
  registerThsrTools(server, ctx);
  registerTraTools(server, ctx);
  registerMetroTools(server, ctx);
  registerAfrTools(server, ctx);
  registerRailTools(server, ctx);
  registerRailStationTools(server, ctx);
  registerAirTools(server, ctx);
  registerShipTools(server, ctx);
  registerTrafficTools(server, ctx);
  registerTravelTimeTools(server, ctx);
  registerParkingTools(server, ctx);
  registerEvTools(server, ctx);
  registerRawTools(server, ctx);
  return server;
}
