# tdx-taiwan-mcp

[![npm](https://img.shields.io/npm/v/tdx-taiwan-mcp)](https://www.npmjs.com/package/tdx-taiwan-mcp)
[![CI](https://github.com/amangeldievkuu/tdx-taiwan-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amangeldievkuu/tdx-taiwan-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/tdx-taiwan-mcp)](https://github.com/amangeldievkuu/tdx-taiwan-mcp/blob/main/LICENSE)

An unofficial [MCP](https://modelcontextprotocol.io) server for Taiwan's
[TDX (Transport Data eXchange)](https://tdx.transportdata.tw) API, built on the
[`tdx-taiwan`](https://www.npmjs.com/package/tdx-taiwan) SDK. It lets Claude and other MCP
clients answer questions such as "where is the nearest YouBike with bikes?" or "when does the
307 reach Ximen?".

- Task-shaped tools: search by name (Chinese or English, 台/臺 folded) or by location, with
  readable output ("4 min", "last bus has passed") instead of raw status codes
- City names as TDX codes or in Chinese (`Taipei`, `臺北市`, `台北`)
- Results capped in size; static lists cached, live data cached for 15 s
- `tdx_get` for any TDX endpoint the tools do not cover yet
- Runs over stdio; Node.js 20+

## Get TDX keys

Register at [tdx.transportdata.tw](https://tdx.transportdata.tw/register), then copy the
**Client Id** and **Client Secret** from **會員中心 → 資料服務 → API金鑰**.

## Set up

### Claude Code

```sh
claude mcp add tdx \
  -e TDX_CLIENT_ID=your-client-id -e TDX_CLIENT_SECRET=your-client-secret \
  -- npx -y tdx-taiwan-mcp
```

### Claude Desktop and other clients

Add the server to the client's MCP configuration (for Claude Desktop,
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tdx": {
      "command": "npx",
      "args": ["-y", "tdx-taiwan-mcp"],
      "env": {
        "TDX_CLIENT_ID": "your-client-id",
        "TDX_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### Environment

| Variable                  | Default  | Meaning                                                              |
| ------------------------- | -------- | -------------------------------------------------------------------- |
| `TDX_CLIENT_ID`           | required | TDX API key Client Id                                                |
| `TDX_CLIENT_SECRET`       | required | TDX API key Client Secret                                            |
| `TDX_REQUESTS_PER_SECOND` | `5`      | Client-side rate limit; match it to your TDX plan (`0` turns it off) |
| `TDX_MAX_ITEMS`           | `200`    | Most items any tool returns                                          |

A `.env` file in the working directory is read too; variables already set take precedence.

## Tools

| Tool               | What it answers                                                                        |
| ------------------ | -------------------------------------------------------------------------------------- |
| `youbike_nearby`   | Nearest YouBike / Moovo stations to a coordinate with bikes (or empty docks) right now |
| `youbike_station`  | YouBike stations by name or address, with live bikes, e-bikes and empty docks          |
| `bus_route_search` | Bus routes by name or terminal stop, with endpoints, operators and fare                |
| `bus_route_stops`  | The stops of a route in order, per direction and sub-route                             |
| `bus_eta`          | Live arrival estimates at the stops of a route, optionally at one stop                 |
| `bus_positions`    | Where the buses on a route are now, with speed and status                              |
| `tdx_get`          | Any TDX API path with OData `filter`, `select`, `orderBy`, `top`, `skip`               |

Bus tools take a city (`Taipei`, `NewTaipei`, ...) or `InterCity` for 公路客運 / 國道客運
coaches. Rail, road, air and ferry tools are on the way; until then `tdx_get` reaches those
endpoints.

## Use as a library

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TdxClient } from 'tdx-taiwan';
import { createServer } from 'tdx-taiwan-mcp';

const tdx = new TdxClient({ clientId: '…', clientSecret: '…', cache: true });
await createServer({ tdx }).connect(new StdioServerTransport());
```

## Rate limits and billing

TDX limits requests per second by plan and bills by call count and response size. The server
caches static lists (stations, routes) for an hour and live data for 15 seconds, and spaces
requests at `TDX_REQUESTS_PER_SECOND`.

## Data source

資料來源：交通部 TDX 運輸資料流通服務平臺 (MOTC Transport Data eXchange). TDX data is subject to
the [TDX 資料授權利用條款](https://tdx.transportdata.tw/term). This project is not affiliated
with MOTC or TDX.

## License

[MIT](https://github.com/amangeldievkuu/tdx-taiwan-mcp/blob/main/LICENSE)
