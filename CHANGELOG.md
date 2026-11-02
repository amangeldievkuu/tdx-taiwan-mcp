# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-11-02

### Added

- Whether a bus is low-floor with a wheelchair ramp (and electric or hybrid, or a small bus):
  `vehicle` in `bus_eta`, `bus_stop_arrivals` and `bus_positions`, from the fleet lists of
  Taipei, New Taipei, Taoyuan, Taichung, Tainan and Kaohsiung. Taipei and New Taipei do not
  name the bus in their arrival estimates, so `bus_eta` takes the nearest bus before each stop
  from the live stop events, and says the vehicle is an estimate; checked against the cities
  that do name it, it picks the right bus for about 96% of estimates. Buses missing from a
  city's list get no `vehicle`.

## [0.8.1] - 2026-11-02

### Fixed

- `bus_fare` finds coach fares for stops that are not fare stages and for city names: "1610
  from 臺北 to 高雄" now lists the fares to the Kaohsiung stages (岡山站, 楠梓站, 建國客運站, ...)
  instead of failing. A stop between stages is charged from the stage before boarding to the
  stage after alighting, flagged `estimated`. Tickets TDX lists as not sold (-1) are left out,
  and a trip with none on sale says so.

## [0.8.0] - 2026-11-02

### Added

- `bus_fare`: a bus route's fares per passenger type and ticket (cash, smart card): between
  two stops or fare stages for coaches, or per section with the buffer zones for city routes.
- `bus_first_last`: the first and last bus of a route on a day, per direction and sub-route.
  Taipei, New Taipei and Tainan publish no list, so there it comes from the timetable.
- `cycling_routes`: a city's cycle paths near a coordinate or by name, road or district, with
  length, end points and completion date.

### Changed

- `bus_positions` adds the stop each bus last arrived at or left, and lists buses seen at a
  stop in the last 15 minutes that send no GPS position; new vehicle statuses (full,
  chartered).
- Requires `tdx-taiwan` 0.19.

## [0.7.1] - 2026-10-28

### Added

- A Claude Desktop extension, `tdx-taiwan-mcp-<version>.mcpb`, attached to every GitHub release:
  open it to install, and Claude Desktop asks for the TDX keys and the tool groups. Built with
  `npm run build:mcpb`, which takes the tool list from the server and validates the manifest;
  CI builds it and runs the unpacked server.

### Changed

- The README has a Traditional Chinese section (繁體中文): install, keys, settings and tips.
- `glama.json` names the maintainer for the Glama MCP directory.

## [0.7.0] - 2026-10-28

### Added

- A disk cache for static data (stations, routes, timetables, fares), kept for a day so a new
  session does not fetch the same lists from TDX again: a cold `metro_travel_time` drops from
  about 110 s to under a second. It lives in `~/.cache/tdx-taiwan-mcp` (`%LOCALAPPDATA%` on
  Windows); `TDX_CACHE_DIR` moves it, and `TDX_CACHE_DIR=off` turns it off. Live data is never
  stored. Needs `tdx-taiwan` 0.18.1.
- `TDX_TOOLS` (and `tools` in `createServer`): load only some groups of tools, e.g. `bus,rail`,
  or leave groups out with `-road,-raw`. The server instructions describe only the loaded
  groups. `TOOL_GROUPS`, `parseToolGroups()` and `instructionsFor()` are exported.

## [0.6.0] - 2026-10-28

### Added

- `traffic_cameras`: live traffic cameras on the freeways, provincial highways or a city's roads,
  by road, place or distance, with their stream links.
- `traffic_signs`: what the changeable message signs show now (travel times, congestion,
  incidents, roadworks), joined to where each sign stands.
- `ferry_positions`: where ferries and other passenger vessels are (AIS), with speed, status
  and the nearest port; by vessel name, near a port or near a point.
- `flight_seats`: whether seats are left on a domestic AE, B7 or DA flight, per cabin when the
  airline says; TDX asks the airline live, so it can take up to 30 s.

### Changed

- `flight_schedule` also covers flights to and from abroad, from the published international
  timetable, with code-share numbers grouped under one flight.
- `traffic_events` adds the latest road news of the network when no filter is set.

## [0.5.0] - 2026-10-28

### Added

- `metro_travel_time`: how long a metro journey takes between two stations over the fastest
  route, with each leg's line, direction and stops, the walking time at each change, how often
  trains run now and the expected wait. Taipei covers the New Taipei lines too (環狀線, 三鶯線)
  and branch shuttles (小碧潭, 新北投); also Kaohsiung, Taichung and the Taoyuan airport line
  (express and local). Stretches TDX's run times do not cover yet (the 廣慈/奉天宮 extension) are
  estimated from the line and flagged.

### Changed

- The freeway and metro routes share one shortest-path search (`src/core/graph.ts`).
- The live check allows each call five minutes, for cold starts under TDX's rate limit.

## [0.4.0] - 2026-10-28

### Added

- `rail_station_departures`: a TRA, THSR or metro station's departures on a day toward every
  destination, from the station timetables (Taipei Metro included, whose live board shows
  arrivals only; late trains after midnight sort last).
- `rail_station_info`: a station's exits with where they come out, stairs, escalators and lifts,
  sorted by distance to a destination when given, plus its lifts, toilets and information
  desks (TRA, THSR, metro).
- `metro_frequency`: minutes between trains through the day per line, for the kind of day of a
  date; covers the Taipei Wenhu line (文湖線), which has no timetable.
- `afr_fare`: Alishan Forest Railway fares per train type and passenger type.
- `thsr_timetable` and `thsr_train` list each train's non-reserved (自由座) cars.

## [0.3.0] - 2026-10-27

### Added

- `bus_stop_arrivals`: every bus due at one stop, all routes in one call, soonest first, with
  the terminal each is heading to. Takes a `stationUID` from `bus_stops_nearby` or a stop name.
- `bus_timetable`: a route's scheduled departures on a day from its first stop or a given stop,
  or its headways for routes run by frequency (cities and InterCity; Kaohsiung publishes none).
- `bus_alerts`: current and upcoming bus detours, suspensions and moved stops, by city or route,
  with the latest operator news.
- A daily live check (`.github/workflows/live.yml`, `npm run check:live`) that calls one tool of
  every kind against TDX.

### Changed

- Requires `tdx-taiwan` 0.17.

## [0.2.0] - 2026-10-27

### Added

- `bus_stops_nearby`: the bus stops near a coordinate, each with its heading and the city bus
  and InterCity coach routes that stop there, ready for `bus_eta`. Uses `tdx-taiwan` 0.16's
  station lists with a `nearby` filter.
- `traffic_travel_time`: car travel time between two national freeway interchanges right now,
  over the fastest route of live eTag gantry times, with each segment's time and speed.
- An MCP registry entry (`server.json`, `mcpName` `io.github.amangeldievkuu/tdx-taiwan-mcp`);
  the release workflow publishes each version to the registry after npm.

### Changed

- Requires `tdx-taiwan` 0.16.

## [0.1.0] - 2026-10-27

### Added

- stdio MCP server (`npx tdx-taiwan-mcp`) and `createServer()` for embedding, on `tdx-taiwan`
  0.15 with its response cache on.
- YouBike tools: `youbike_nearby` and `youbike_station`.
- Bus tools for city buses and InterCity coaches: `bus_route_search`, `bus_route_stops`,
  `bus_eta` and `bus_positions`.
- Rail tools: `thsr_timetable`, `thsr_seats`, `thsr_fare`, `thsr_train`, `tra_timetable`,
  `tra_live_board`, `tra_train`, `tra_fare`, `metro_live_board`, `metro_fare`,
  `metro_first_last_train`, `afr_timetable`, `rail_station_search` and `rail_alerts`. Stations
  are given by Chinese or English name (`台北車站` finds TRA 臺北 and both Taipei Metro IDs) or
  by ID, and today's departures start from the current time in Taiwan.
- Flight tools: `flight_status`, `flight_board` (a Taiwan airport's live departures or arrivals,
  with the airport weather) and `flight_schedule` (domestic flights between two airports on a
  day, with fares). Airports are given by IATA code or name (`松山`, `Kinmen`).
- Ferry tools: `ferry_timetable` (sailings between two ports, with today's live status and the
  alerts in force), `ferry_live_board`, `ferry_fare` and `ferry_alerts`. Ports are given by name;
  county-run lines (Penghu inter-island, 旗津, 淡水) by adding `city`.
- Road tools: `traffic_live` (speed and congestion per section, worst first, with a count per
  level) and `traffic_events` (accidents, roadworks, closures and announced events) for the
  freeways, provincial highways and cities.
- Parking and EV tools: `parking_nearby` and `parking_search` (car parks and on-street parking
  with live free spaces for cars or scooters) and `ev_charger_nearby` (connectors by type and
  power with live free / in use / out of order counts, in a city or at freeway service areas).
- `tdx_get` for any TDX path with OData options.
- Chinese city names (`臺北市`, `台北`), 台/臺-insensitive name search, output capped at
  `TDX_MAX_ITEMS` items and 40,000 characters, and TDX errors (unsupported city, 404, 429,
  bad keys) reported as readable tool errors.

[Unreleased]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/releases/tag/v0.1.0
