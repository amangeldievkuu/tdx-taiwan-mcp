# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/releases/tag/v0.1.0
