# Test fixtures

> 資料來源：交通部運輸資料流通服務平臺 (MOTC Transport Data eXchange, TDX). The
> `bus-position-taipei-307.json`, `bus-intercity-*.json`, `air-*.json`, `ship-*.json`,
> `traffic-*.json`, `parking-*.json` and `ev-*.json` files contain TDX data and are used under
> the [TDX 資料授權利用條款](https://tdx.transportdata.tw/term), not this repository's MIT license.

Copied unchanged from the [`tdx-taiwan`](https://github.com/amangeldievkuu/tdx-taiwan) test
fixtures, which describe how each was made. In short: `bike-*.json` and the other Taipei 307
files are schema-derived samples with illustrative values (a suspended station with `null`
availability, a not-yet-departed bus, a "last bus has passed" stop); the files named above are
trimmed live responses from 2026-10-20 (the air, ship, traffic, parking and EV files:
2026-10-21). Where the SDK has no fixture, the tests build small wrappers inline (ferry stop
lists and timetables, freeway live traffic, Taipei live events, a city without parking data,
freeway EV connectors).
