# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/amangeldievkuu/tdx-taiwan-mcp/commits/main
