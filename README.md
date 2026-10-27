# tdx-taiwan-mcp

[![npm](https://img.shields.io/npm/v/tdx-taiwan-mcp)](https://www.npmjs.com/package/tdx-taiwan-mcp)
[![CI](https://github.com/amangeldievkuu/tdx-taiwan-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amangeldievkuu/tdx-taiwan-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/tdx-taiwan-mcp)](https://github.com/amangeldievkuu/tdx-taiwan-mcp/blob/main/LICENSE)

An unofficial [MCP](https://modelcontextprotocol.io) server for Taiwan's
[TDX (Transport Data eXchange)](https://tdx.transportdata.tw) API, built on the
[`tdx-taiwan`](https://www.npmjs.com/package/tdx-taiwan) SDK. It lets Claude and other MCP
clients answer questions such as "where is the nearest YouBike with bikes?", "when does the
307 reach Ximen?", "which high speed trains to Zuoying still have seats tonight?", "is CI100
delayed?" or "where can I charge a CCS2 car near Taipei Main Station?".

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

### YouBike and buses

| Tool               | What it answers                                                                        |
| ------------------ | -------------------------------------------------------------------------------------- |
| `youbike_nearby`   | Nearest YouBike / Moovo stations to a coordinate with bikes (or empty docks) right now |
| `youbike_station`  | YouBike stations by name or address, with live bikes, e-bikes and empty docks          |
| `bus_route_search` | Bus routes by name or terminal stop, with endpoints, operators and fare                |
| `bus_route_stops`  | The stops of a route in order, per direction and sub-route                             |
| `bus_eta`          | Live arrival estimates at the stops of a route, optionally at one stop                 |
| `bus_positions`    | Where the buses on a route are now, with speed and status                              |

Bus tools take a city (`Taipei`, `NewTaipei`, ...) or `InterCity` for 公路客運 / 國道客運
coaches.

### Rail

| Tool                     | What it answers                                                             |
| ------------------------ | --------------------------------------------------------------------------- |
| `thsr_timetable`         | High speed rail (高鐵) trains between two stations on a day                 |
| `thsr_seats`             | Standard and business seat availability for those trains                    |
| `thsr_fare`              | THSR fares per car and passenger type                                       |
| `thsr_train`             | Every stop of one THSR train                                                |
| `tra_timetable`          | Taiwan Railway (臺鐵) trains between two stations, with train type          |
| `tra_live_board`         | Trains about to arrive at or leave a TRA station, with delays               |
| `tra_train`              | One TRA train today: stops, current position and delay                      |
| `tra_fare`               | TRA fares per train type and passenger type                                 |
| `metro_live_board`       | Minutes to the next metro trains (Kaohsiung, Taoyuan; Taipei arrivals only) |
| `metro_fare`             | Metro fares between two stations                                            |
| `metro_first_last_train` | First and last trains at a metro station                                    |
| `afr_timetable`          | Alishan Forest Railway (阿里山林業鐵路) regular timetable                   |
| `rail_station_search`    | Stations of any rail system by name, or nearest to a coordinate             |
| `rail_alerts`            | Service status and disruptions of THSR, TRA or a metro                      |

Rail tools take station names in Chinese or English (`台北`, `Taipei`, `台北車站`) or station
IDs. For today, timetables start from the current time in Taiwan.

### Flights

| Tool              | What it answers                                                                      |
| ----------------- | ------------------------------------------------------------------------------------ |
| `flight_status`   | Times, delay, gate and status of a flight (`CI100`)                                  |
| `flight_board`    | A Taiwan airport's departure or arrival board, with the current weather              |
| `flight_schedule` | Domestic flights between two Taiwan airports on a day (華信, 立榮, 德安), with fares |

Airports are IATA codes or names (`TSA`, `松山`, `Kinmen`).

### Ferries

| Tool               | What it answers                                                                   |
| ------------------ | --------------------------------------------------------------------------------- |
| `ferry_timetable`  | Sailings between two ports on a day, with live status and alerts (typhoons) today |
| `ferry_live_board` | A port's departures and arrivals today, with delays and cancellations             |
| `ferry_fare`       | Fares between two ports per ticket, cabin and passenger type                      |
| `ferry_alerts`     | Current suspensions and changes to ferry service                                  |

Ports are names (`富岡`, `綠島`, `小琉球`) or port IDs. Lines run by a county (Penghu
inter-island boats, 旗津, 淡水) need `city`, e.g. `PenghuCounty`.

### Roads

| Tool             | What it answers                                                                   |
| ---------------- | --------------------------------------------------------------------------------- |
| `traffic_live`   | Live speed and congestion per road section, worst first, with a count per level   |
| `traffic_events` | Accidents, roadworks, closures and announced events (parades) with where they are |

Road tools take a network: `freeway` (國道), `highway` (省道) or a city. Freeway sections are
named after interchanges, so search them by keyword (`林口`).

### Parking and EV charging

| Tool                | What it answers                                                                |
| ------------------- | ------------------------------------------------------------------------------ |
| `parking_nearby`    | Nearest car parks and on-street parking with free car or scooter spaces now    |
| `parking_search`    | Car parks and on-street parking by name, address or road, with free spaces     |
| `ev_charger_nearby` | Nearest EV chargers with a free connector (CCS2, Tesla, ...), AC or DC, prices |

Coverage differs per city: NewTaipei has on-street parking only, and not every car park
publishes live spaces (those show "no live data"). `ev_charger_nearby` takes `freeway` for the
freeway service areas.

### Other

| Tool      | What it answers                                                          |
| --------- | ------------------------------------------------------------------------ |
| `tdx_get` | Any TDX API path with OData `filter`, `select`, `orderBy`, `top`, `skip` |

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
requests at `TDX_REQUESTS_PER_SECOND`. When TDX still answers 429 (the basic plan also limits
calls per minute), the server waits as TDX asks and retries, so a tool call can take up to a
minute during a burst of questions.

## Data source

資料來源：交通部 TDX 運輸資料流通服務平臺 (MOTC Transport Data eXchange). TDX data is subject to
the [TDX 資料授權利用條款](https://tdx.transportdata.tw/term). This project is not affiliated
with MOTC or TDX.

## License

[MIT](https://github.com/amangeldievkuu/tdx-taiwan-mcp/blob/main/LICENSE)
