# tdx-taiwan-mcp

[![npm](https://img.shields.io/npm/v/tdx-taiwan-mcp)](https://www.npmjs.com/package/tdx-taiwan-mcp)
[![CI](https://github.com/amangeldievkuu/tdx-taiwan-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amangeldievkuu/tdx-taiwan-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/amangeldievkuu/tdx-taiwan-mcp)](https://github.com/amangeldievkuu/tdx-taiwan-mcp/blob/main/LICENSE)

[繁體中文說明](#繁體中文)

An unofficial [MCP](https://modelcontextprotocol.io) server for Taiwan's
[TDX (Transport Data eXchange)](https://tdx.transportdata.tw) API, built on the
[`tdx-taiwan`](https://www.npmjs.com/package/tdx-taiwan) SDK. It lets Claude and other MCP
clients answer questions such as "where is the nearest YouBike with bikes?", "when does the
307 reach Ximen?", "which high speed trains to Zuoying still have seats tonight?", "is CI100
delayed?" or "where can I charge a CCS2 car near Taipei Main Station?".

- Task-shaped tools: search by name (Chinese or English, 台/臺 folded) or by location, with
  readable output ("4 min", "last bus has passed") instead of raw status codes
- City names as TDX codes or in Chinese (`Taipei`, `臺北市`, `台北`)
- Results capped in size; static lists kept on disk for a day, live data cached for 15 s
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

### Claude Desktop

Download `tdx-taiwan-mcp-<version>.mcpb` from the
[latest release](https://github.com/amangeldievkuu/tdx-taiwan-mcp/releases/latest) and open it
(or drag it into Settings → Extensions). Claude Desktop asks for your TDX Client Id and Secret,
stores the secret in the system keychain, and runs the server with its own Node.js. The
settings also take the tool groups to load (see `TDX_TOOLS` below).

### Other clients

Add the server to the client's MCP configuration (or Claude Desktop's
`claude_desktop_config.json`, instead of the extension):

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

| Variable                  | Default   | Meaning                                                              |
| ------------------------- | --------- | -------------------------------------------------------------------- |
| `TDX_CLIENT_ID`           | required  | TDX API key Client Id                                                |
| `TDX_CLIENT_SECRET`       | required  | TDX API key Client Secret                                            |
| `TDX_REQUESTS_PER_SECOND` | `5`       | Client-side rate limit; match it to your TDX plan (`0` turns it off) |
| `TDX_MAX_ITEMS`           | `200`     | Most items any tool returns                                          |
| `TDX_CACHE_DIR`           | see below | Where static data is kept between runs; `off` turns it off           |
| `TDX_TOOLS`               | `all`     | Tool groups to load, e.g. `bus,rail` or `-road,-raw` (see below)     |

A `.env` file in the working directory is read too; variables already set take precedence.

**Disk cache.** Station, route and timetable lists are kept on disk for a day, so a new
session answers from them instead of calling TDX again. A first metro journey that took close
to two minutes on the free plan's per-minute quota then takes a fraction of a second. The
default folder is `~/.cache/tdx-taiwan-mcp` (`$XDG_CACHE_HOME` if set; `%LOCALAPPDATA%` on
Windows), a few MB at most. Live data (arrivals, availability, positions) is never stored.

**Loading fewer tools.** Every tool's description goes into the model's context, and with 47 of
them a model can pick the wrong one. If you only need some areas, list them in `TDX_TOOLS`:
`bike`, `bus`, `rail` (THSR, TRA, metro, Alishan), `flight`, `ferry`, `road`, `parking`, `ev`
and `raw` (`tdx_get`). A list loads only those groups (`bus,rail`); names with a minus leave
groups out of all of them (`-road,-raw`). The server's instructions to the model cover only the
loaded groups.

## Tools

### YouBike and buses

| Tool                | What it answers                                                                        |
| ------------------- | -------------------------------------------------------------------------------------- |
| `youbike_nearby`    | Nearest YouBike / Moovo stations to a coordinate with bikes (or empty docks) right now |
| `youbike_station`   | YouBike stations by name or address, with live bikes, e-bikes and empty docks          |
| `bus_stops_nearby`  | Bus stops near a coordinate, with their heading and the city and coach routes there    |
| `bus_stop_arrivals` | Every bus due at one stop, all routes at once, soonest first                           |
| `bus_route_search`  | Bus routes by name or terminal stop, with endpoints, operators and fare                |
| `bus_route_stops`   | The stops of a route in order, per direction and sub-route                             |
| `bus_eta`           | Live arrival estimates at the stops of a route, optionally at one stop                 |
| `bus_timetable`     | Scheduled departures of a route on a day, or how often it runs                         |
| `bus_alerts`        | Current and upcoming detours, suspensions and moved stops, with the latest news        |
| `bus_positions`     | Where the buses on a route are now, with speed and status                              |

Bus tools take a city (`Taipei`, `NewTaipei`, ...) or `InterCity` for 公路客運 / 國道客運
coaches.

### Rail

| Tool                      | What it answers                                                               |
| ------------------------- | ----------------------------------------------------------------------------- |
| `thsr_timetable`          | High speed rail (高鐵) trains between two stations on a day                   |
| `thsr_seats`              | Standard and business seat availability for those trains                      |
| `thsr_fare`               | THSR fares per car and passenger type                                         |
| `thsr_train`              | Every stop of one THSR train, with its non-reserved (自由座) cars             |
| `tra_timetable`           | Taiwan Railway (臺鐵) trains between two stations, with train type            |
| `tra_live_board`          | Trains about to arrive at or leave a TRA station, with delays                 |
| `tra_train`               | One TRA train today: stops, current position and delay                        |
| `tra_fare`                | TRA fares per train type and passenger type                                   |
| `metro_live_board`        | Minutes to the next metro trains (Kaohsiung, Taoyuan; Taipei arrivals only)   |
| `metro_fare`              | Metro fares between two stations                                              |
| `metro_first_last_train`  | First and last trains at a metro station                                      |
| `metro_travel_time`       | Metro journey time between two stations, with line changes and expected waits |
| `metro_frequency`         | Minutes between metro trains through the day, per line (incl. 文湖線)         |
| `rail_station_departures` | A TRA, THSR or metro station's departures on a day, toward every destination  |
| `rail_station_info`       | Station exits (nearest to your destination first), lifts and toilets          |
| `afr_timetable`           | Alishan Forest Railway (阿里山林業鐵路) regular timetable                     |
| `afr_fare`                | Alishan Forest Railway fares per train type                                   |
| `rail_station_search`     | Stations of any rail system by name, or nearest to a coordinate               |
| `rail_alerts`             | Service status and disruptions of THSR, TRA or a metro                        |

Rail tools take station names in Chinese or English (`台北`, `Taipei`, `台北車站`) or station
IDs. For today, timetables start from the current time in Taiwan.

### Flights

| Tool              | What it answers                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `flight_status`   | Times, delay, gate and status of a flight (`CI100`)                                             |
| `flight_board`    | A Taiwan airport's departure or arrival board, with the current weather                         |
| `flight_schedule` | Flights between two airports on a day: domestic (華信, 立榮, 德安) with fares, or international |
| `flight_seats`    | Seats left on a domestic flight (available, fewer than 5, sold out); slow, asks the airline     |

Airports are IATA codes or names (`TSA`, `松山`, `Kinmen`).

### Ferries

| Tool               | What it answers                                                                   |
| ------------------ | --------------------------------------------------------------------------------- |
| `ferry_timetable`  | Sailings between two ports on a day, with live status and alerts (typhoons) today |
| `ferry_live_board` | A port's departures and arrivals today, with delays and cancellations             |
| `ferry_fare`       | Fares between two ports per ticket, cabin and passenger type                      |
| `ferry_alerts`     | Current suspensions and changes to ferry service                                  |
| `ferry_positions`  | Where ferries are now (AIS): position, speed, status and nearest port             |

Ports are names (`富岡`, `綠島`, `小琉球`) or port IDs. Lines run by a county (Penghu
inter-island boats, 旗津, 淡水) need `city`, e.g. `PenghuCounty`.

### Roads

| Tool                  | What it answers                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `traffic_live`        | Live speed and congestion per road section, worst first, with a count per level          |
| `traffic_travel_time` | Car travel time between two freeway interchanges now, from live eTag data, per segment   |
| `traffic_events`      | Accidents, roadworks, closures and announced events (parades), with the latest road news |
| `traffic_cameras`     | Live traffic cameras by road, place or distance, with their stream links                 |
| `traffic_signs`       | What the message signs over the road show now: travel times, warnings                    |

Road tools take a network: `freeway` (國道), `highway` (省道) or a city; `traffic_travel_time`
takes freeway interchange names in Chinese (`林口`, `新竹`). Freeway sections are
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

## MCP registry

The server is listed in the [MCP registry](https://registry.modelcontextprotocol.io) as
`io.github.amangeldievkuu/tdx-taiwan-mcp`, so clients that browse the registry can install it
with the two TDX variables above.

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

## 繁體中文

`tdx-taiwan-mcp` 是交通部 [TDX 運輸資料流通服務](https://tdx.transportdata.tw)的**非官方** MCP 伺服器（與交通部無隸屬或合作關係），讓 Claude 等 MCP 用戶端以即時資料回答「最近哪個 YouBike 站有車？」「307 公車幾分鐘到西門？」「今晚往左營的高鐵還有座位嗎？」「CI100 有沒有誤點？」等問題，涵蓋 YouBike、市區公車與公路客運、高鐵、臺鐵、捷運、阿里山林業鐵路、國內外航班、船運、即時路況與路況影像、停車場及充電樁。

**取得金鑰**：註冊 TDX 會員後，至「會員中心 → 資料服務 → API金鑰」取得 Client Id 與 Client Secret。

**安裝**

- Claude Desktop：從[最新版本](https://github.com/amangeldievkuu/tdx-taiwan-mcp/releases/latest)下載 `tdx-taiwan-mcp-<版本>.mcpb` 並開啟，依提示填入 Client Id 與 Client Secret（密鑰存於系統鑰匙圈）。
- Claude Code：

  ```sh
  claude mcp add tdx \
    -e TDX_CLIENT_ID=你的-client-id -e TDX_CLIENT_SECRET=你的-client-secret \
    -- npx -y tdx-taiwan-mcp
  ```

- 其他用戶端：以 `npx -y tdx-taiwan-mcp` 啟動，並設定上述兩個環境變數（需要 Node.js 20 以上版本）。

**設定**（環境變數）

- `TDX_TOOLS`：只載入部分工具群組，例如 `bus,rail`；加上減號可排除，例如 `-road,-raw`。群組有 `bike`、`bus`、`rail`（高鐵、臺鐵、捷運、阿里山）、`flight`、`ferry`、`road`、`parking`、`ev` 與 `raw`（`tdx_get`）。工具愈少，模型愈容易選對工具。
- `TDX_CACHE_DIR`：站點、路線、時刻表等靜態資料會在磁碟保存一天（預設 `~/.cache/tdx-taiwan-mcp`），新的工作階段不必再向 TDX 下載；設為 `off` 可關閉。即時資料不會存檔。
- `TDX_REQUESTS_PER_SECOND`：用戶端限流，預設每秒 5 次，請依您的 TDX 方案調整。`TDX_MAX_ITEMS`：每個工具最多回傳的筆數，預設 200。

**使用提示**：站名、港口與機場可用中文或英文（台北、Taipei、松山、TSA）；城市可用 TDX 代碼或中文（`Taipei`、`臺北市`）；時間皆為臺灣時間（UTC+8）。公車工具需要完整路線名稱，可先用 `bus_route_search` 查詢。

## Data source

資料來源：交通部 TDX 運輸資料流通服務平臺 (MOTC Transport Data eXchange). TDX data is subject to
the [TDX 資料授權利用條款](https://tdx.transportdata.tw/term). This project is not affiliated
with MOTC or TDX.

## License

[MIT](https://github.com/amangeldievkuu/tdx-taiwan-mcp/blob/main/LICENSE)
