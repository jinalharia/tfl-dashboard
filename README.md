# tfl-dashboard

A static HTML dashboard showing **live crowding for every line at a London station**, built on the [TfL Unified API](https://api.tfl.gov.uk/swagger/ui/index.html) and the TfL Crowding API.

A **network status strip** under the top bar shows every Underground, Elizabeth line, DLR, Overground and Tram line, with lines that have problems first. It shows even before you choose a station. Select a disrupted line to read TfL's details.

Search for a station (or pick a popular one) and the dashboard shows:

- **Live busyness per station entrance group.** TfL publishes crowding per station NaPTAN, and interchanges have one per network. At Stratford, for example, the Underground (Central, Jubilee), the Elizabeth line and Overground, and the DLR each get their own live reading, compared with what's usual for this time of day.
- **Today: typical vs live.** Today's typical 15-minute busyness profile for each group, with a "now" line and the live reading marked on it. Hover (or focus and use the arrow keys) to read values. There's also a data table view.
- **A card for each line** with:
  - line status and disruption details
  - the live station busyness for the entrances that line uses, with a tick for what's usual now
  - a *boarding estimate* per direction: whether you're likely to get on the first train or need to let one or more go (see below). Lines without loading data show the simpler *platform outlook* instead.
  - typical passenger flow for that line at the station by time of day, as a small chart
  - the next trains on each platform
- **Step-free access alerts** when a lift at the station is out of service (or a note that none are reported).
- **Station information:**
  - disruption notices TfL has posted for the station (e.g. part closures, escalator faults), with dates
  - facilities (lifts, escalators, toilets, Wi-Fi, cash machines, ticket halls, help points), per network at interchanges
  - the nearest Santander Cycles docks with live bikes, e-bikes and free docks
- **Planned closures in the next 14 days** for the station's lines: TfL's planned works that are running now or start later, grouped by line, with London dates and times.
- **A quieter-time hint** for each entrance group, e.g. "Usually quieter from 18:45 (about 40%)", from today's typical profile.

The page refreshes live data every 60 seconds. You can switch this off.

## Running it

It has no build step and no dependencies. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly from disk also works.

- **Demo mode:** add `?demo` to the URL (e.g. `http://localhost:8000/?demo`) to use synthetic data shaped like the TfL responses. It's useful offline or when you're rate limited.
- **Deep link:** `?station=940GZZLUOXC` opens a station directly. You can use any StopPoint id or hub id, e.g. `HUBSRA`.
- **App key:** the API works without a key at a lower rate limit. To raise it, register at the [TfL API portal](https://api-portal.tfl.gov.uk/) and paste your primary key into **Settings**. The key is stored only in your browser's `localStorage`.

## TfL endpoints used

| Purpose | Endpoint |
|---|---|
| Station search | `GET /StopPoint/Search/{query}?modes=tube,elizabeth-line,dlr,overground,tram` |
| Station, child stops, lines per NaPTAN | `GET /StopPoint/{id}` (and its `hubNaptanCode`, so every line at an interchange is included) |
| Live station busyness | `GET /crowding/{naptan}/Live` → `dataAvailable`, `percentageOfBaseline`, `timeLocal` |
| Typical busyness for today | `GET /crowding/{naptan}/{dayOfWeek}` → `timeBands[].percentageOfBaseLine`, AM/PM peak bands |
| Line status | `GET /Line/{ids}/Status` |
| Next trains | `GET /StopPoint/{naptan}/Arrivals` |
| Network status strip (every line) | `GET /Line/Mode/tube,elizabeth-line,dlr,overground,tram/Status` → one entry per line (20 on 2026-09-27) with `lineStatuses[]` |
| Planned closures, next 14 days | `GET /Line/{ids}/Status/{YYYY-MM-DD}/to/{YYYY-MM-DD}` → `lineStatuses[].validityPeriods[{fromDate, toDate}]`, `reason`, `disruption.category` (`PlannedWork`) |
| Route order (to find the previous station in each direction) | `GET /Line/{id}/Route/Sequence/all` → `orderedLineRoutes[].naptanIds`, names from `stopPointSequences[].stopPoint[]` |
| Typical train loading and passenger flow per line | `GET /StopPoint/{naptan}/Crowding/{line}?direction=all` → `lines[].crowding.trainLoadings` and `passengerFlows` |
| Station disruption notices | `GET /StopPoint/{id}/Disruption?getFamily=true&flattenResponse=true` → `description`, `type`, `appearance`, `fromDate`, `toDate`, `additionalInformation`, `mode`. **One id per call**: a comma list with `getFamily` returns `ApiArgumentException`. Identical repeats (one per mode) are de-duplicated on `description` + `fromDate`. |
| Station facilities, nearby bike docks | `GET /StopPoint/{id}` (already loaded): `additionalProperties` with `category: "Facility"` (per child station at hubs), `VisitorCentre`, `Address` → `PhoneNo`, and `NearestPlaces` → `BikePoints_*` ids |
| Live Santander Cycles availability | `GET /Occupancy/BikePoints/{ids}` → `name`, `bikesCount`, `standardBikesCount`, `eBikesCount`, `emptyDocks`, `totalDocks` |
| Bike dock distances (to pick the nearest) | `GET /Place?type=BikePoint&lat={lat}&lon={lon}&radius=800` → `places[].distance` (straight-line metres). Loaded once per station; if it fails, docks are shown in TfL's listed order without distances. |
| Lift faults (step-free access) | `GET /Disruptions/Lifts/v2/` → `stationUniqueId` (hub or station code), `disruptedLiftUniqueIds`, `message`. Used by tfl.gov.uk but not in the published swagger, so the dashboard hides lift status if it fails. |

**Coverage:** TfL doesn't publish crowding for every station. When checked, it was available for Underground stations and some Elizabeth line stations such as Bond Street (`910GBONDST`), but not for Stratford's DLR or rail entrances (`940GZZDLSTD`, `910GSTFD`) or Liverpool Street rail (`910GLIVST`). When the API reports `isFound: false` and no live reading, the dashboard says there's no data rather than showing a blank.

Crowding bands used for the labels: Quiet < 25%, Moderately busy 25–50%, Busy 50–75%, Very busy ≥ 75% of baseline.

**Typical passenger flow** is the sum of the unlabelled `passengerFlows` values TfL returns per 15-minute slice. TfL doesn't say which are entries, exits or interchanges, or which day type the profile is for (its peaks look like a weekday). On weekends the card says so.

**Planned closures** keeps entries that are TfL planned works (still running or yet to start) and any other entry that hasn't started yet. It drops Good Service, entries that have ended, and live incidents already under way, because those are in each line card's status. TfL sometimes sends the same entry twice, so identical ones are shown once.

**Quieter-time hint** looks up to 3 hours ahead in today's typical profile. It finds the first half-hour that sits a crowding band below the current live reading, or, when it's quiet now, the next busier period.

**Boarding estimate** is this dashboard's own estimate, not a TfL figure. For each direction it uses TfL's typical train-loading scores (0–6; 6 is full) for the current 15 minutes:
- how full trains usually leave this station (this station's row to the next station)
- how full they arrive: the previous station's row towards here, found from the route sequence. If the train *starts* here in that direction it arrives **empty**, as on the Waterloo & City line at both Waterloo and Bank. A row from the other direction ending here (e.g. Bank → Waterloo) is never used, because those passengers get off.
- an assumed 30% of arriving passengers getting off. TfL doesn't publish alighting numbers.

Boarders ÷ room gives a ratio, scaled by live ÷ typical station busyness, ×1.5 for severe disruption, ×1.2 for minor delays, and ×1.2 when the next train on that platform is 8+ minutes away. Up to 0.85 means board the first train, up to 1 means tight, up to 2 means let 1 train go, and more means let 2 or more go. When trains usually leave full (score 6), the ratio is at least the busyness and disruption factors, because the loading score can't show demand above full. TfL publishes no platform queue or live train-load data to check it against, so treat it as a rough guide.

**Platform outlook** (lines without loading data) is this dashboard's own heuristic, not a TfL figure. It starts from the station's live level and raises it for disruption on that line (a full step for severe disruption, part of a step for minor delays) and a little when the next train is 8 or more minutes away.

## Project layout

```
index.html          page shell
css/styles.css      styles (light + dark themes)
js/tfl-api.js       API client and response normalisation (pure helpers are unit-tested)
js/chart.js         SVG busyness profile chart with hover/keyboard tooltip
js/app.js           search, loading, refresh and rendering
js/demo-data.js     synthetic TfL-shaped responses for ?demo
tests/              node:test unit tests
```

Run the tests with `npm test` (Node 18+).
