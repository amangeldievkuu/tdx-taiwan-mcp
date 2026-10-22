import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ODataOptions, SortDirection } from 'tdx-taiwan';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { compact } from '../core/format.js';
import { ok } from '../core/respond.js';
import { defineTool } from '../core/tool.js';

const BASE = /^https?:\/\/tdx\.transportdata\.tw\/api\/basic/;

export function registerRawTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'tdx_get', {
    title: 'Query any TDX endpoint',
    description:
      'GET any TDX API path (https://tdx.transportdata.tw/api-service/swagger) with OData ' +
      'options. Use it only when no specific tool covers the data. Field names in filter, ' +
      'select and orderBy are TDX field names (e.g. StationName/Zh_tw). Results are not ' +
      'cached and null or empty fields are dropped. Example: path "/v2/Rail/THSR/Station", ' +
      'select ["StationID","StationName"], top 5.',
    input: {
      path: z
        .string()
        .trim()
        .describe('API path starting with a version, e.g. /v2/Bike/Station/City/Taipei.'),
      filter: z
        .string()
        .optional()
        .describe(
          'OData $filter, e.g. "AvailableRentBikes gt 0 and contains(StationName/Zh_tw,\'捷運\')".',
        ),
      select: z.array(z.string()).optional().describe('Top-level fields to return ($select).'),
      orderBy: z
        .array(z.string())
        .optional()
        .describe('Sort keys ($orderby), each "Field" or "Field desc", e.g. ["UpdateTime desc"].'),
      top: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Maximum items ($top, default 30).'),
      skip: z.number().int().min(0).optional().describe('Items to skip ($skip), for paging.'),
    },
    run: async ({ path, filter, select, orderBy, top, skip }) => {
      const options: ODataOptions = {
        filter,
        select,
        orderBy: orderBy?.map(sortKey),
        top: top ?? 30,
        skip,
      };
      const data = await ctx.tdx.get(apiPath(path), options);
      return ok(compact(data) ?? []);
    },
  });
}

/** Accepts a path or a full TDX URL; rejects query strings, which belong in the options. */
function apiPath(input: string): string {
  const path = input.replace(BASE, '');
  if (path.includes('?')) {
    throw new ToolInputError(
      'Put OData options in filter, select, orderBy, top and skip, not in the path.',
    );
  }
  if (!/^\/v\d\/[A-Za-z]/.test(path) || path.includes('..')) {
    throw new ToolInputError(
      `"${input}" is not a TDX API path. Paths start with a version, e.g. /v2/Bus/Route/City/Taipei.`,
    );
  }
  return path;
}

function sortKey(key: string): [string, SortDirection] {
  const [field = '', direction] = key.trim().split(/\s+/);
  if (direction !== undefined && direction !== 'asc' && direction !== 'desc') {
    throw new ToolInputError(`orderBy entries are "Field" or "Field desc", got "${key}".`);
  }
  return [field, direction ?? 'asc'];
}
