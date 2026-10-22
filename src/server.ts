import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TdxClient } from 'tdx-taiwan';
import type { ToolContext } from './core/context.js';
import { registerAfrTools } from './tools/afr.js';
import { registerBikeTools } from './tools/bike.js';
import { registerBusTools } from './tools/bus.js';
import { registerMetroTools } from './tools/metro.js';
import { registerRailTools } from './tools/rail.js';
import { registerRawTools } from './tools/raw.js';
import { registerThsrTools } from './tools/thsr.js';
import { registerTraTools } from './tools/tra.js';
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
availability; city and intercity bus routes, stops, live arrival times and bus positions; high
speed rail (THSR), Taiwan Railway (TRA), metro and Alishan railway timetables, live boards,
seats, fares and alerts.
Cities are TDX codes such as Taipei, NewTaipei, Taoyuan, Taichung, Tainan, Kaohsiung (Chinese
names like 臺北市 work too). Times are Taiwan time (UTC+8). Bus tools need the exact route name;
find it with bus_route_search first. Rail tools take station names in Chinese or English
(台北, Taipei) or station IDs. Use tdx_get only when no other tool covers the data.
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
  registerThsrTools(server, ctx);
  registerTraTools(server, ctx);
  registerMetroTools(server, ctx);
  registerAfrTools(server, ctx);
  registerRailTools(server, ctx);
  registerRawTools(server, ctx);
  return server;
}
