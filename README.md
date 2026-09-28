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
  - on Underground lines, a **Show whole line** button: live busyness at every station along the line, in route order (see below)
- **Step-free access alerts** when a lift at the station is out of service (or a note that none are reported).
- **Station information** (off by default; turn it on with the *Station information* toggle next to Auto-refresh, and your browser remembers the choice. While it's off, none of its TfL requests are made):
  - disruption notices TfL has posted for the station (e.g. part closures, escalator faults), with dates
  - facilities (lifts, escalators, toilets, Wi-Fi, cash machines, ticket halls, help points), per network at interchanges
  - the nearest Santander Cycles docks with live bikes, e-bikes and free docks
- **Planned closures in the next 14 days** for the station's lines: TfL's planned works that are running now or start later, grouped by line, with London dates and times.
- **A quieter-time hint** for each entrance group, e.g. "Usually quieter from 18:45 (about 40%)", from today's typical profile.

The page refreshes live data every 60 seconds. You can switch this off.

### South Western Railway tab

A tab bar under the top bar switches between **TfL** (everything above) and **SWR**, for South Western Railway trains. The SWR tab has its own station search over all 204 SWR stations (by name or station code, e.g. `SUR`), quick picks, and a station header with an *Auto-refresh (60 s)* switch and *Refresh now*. Its sections (departures, service status, seat busyness, closures, punctuality) are being added package by package; see `plan.md`.

- **Departures:** the next 15 SWR trains with scheduled and expected time (*On time*, *Exp 19:45, 15 min late*, *Delayed* or *Cancelled*, in the status colours with text), platform, destination and number of coaches. A train of 1–5 coaches is flagged "Short train (N coaches), may be busier", which is this dashboard's own heuristic. The delay or cancellation reason goes under the row, and replacement buses have their own list. At shared stations such as Clapham Junction only SWR trains show unless you tick *Show all operators* (remembered). **Stops** on a row opens its calling points. Train length and reasons come from Huxley2; if it's down, the board still shows without them.
- Stations TfL also covers (Waterloo, Vauxhall, Clapham Junction, Wimbledon, Richmond) link between the tabs: **Open in TfL tab** on the SWR tab, and **SWR trains from here** on a TfL station served by SWR.
- Nothing on the SWR tab is requested until you first open it, and while it's showing, the TfL tab's refresh and network strip pause (they catch up when you switch back). The browser remembers the last tab.

## Running it

It has no build step and no dependencies. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly from disk also works.

- **Demo mode:** add `?demo` to the URL (e.g. `http://localhost:8000/?demo`) to use synthetic data shaped like the TfL responses. It's useful offline or when you're rate limited.
- **Deep link:** `?station=940GZZLUOXC` opens a station directly. You can use any StopPoint id or hub id, e.g. `HUBSRA`. `?tab=swr&swr=WAT` opens the SWR tab at London Waterloo (any SWR station code).
- **App key:** the API works without a key at a lower rate limit. To raise it, register at the [TfL API portal](https://api-portal.tfl.gov.uk/) and paste your primary key into **Settings**. The key is stored only in your browser's `localStorage`.

## Deploying

The site is live at https://jinalharia.github.io/tfl-dashboard/. Pages is set to deploy from **GitHub Actions** (Settings → Pages → Build and deployment → Source), so only tested site files are published. The workflow in `.github/workflows/pages.yml` runs on every push to `main`, every pull request against `main`, every 15 minutes (`schedule`, to refresh the SWR status snapshot) and on demand (*Actions → Test and deploy to Pages → Run workflow*):

- **`test`** runs `npm test` and checks the syntax of every file in `js/`, `tests/` and `scripts/`. Pull requests show it as a check.
- **`deploy`** runs only for a push, a scheduled run or a manual run on `main`, and only if `test` passed. It copies just `index.html`, `css/`, `js/` and `data/` (plus an empty `.nojekyll`) into `_site/`, adds a fresh SWR status snapshot, and publishes that to GitHub Pages. The README, `plan.md`, `tests/`, `scripts/`, `package.json` and the workflows aren't published.

**Snapshots.** SWR's website API sends no CORS headers, so `scripts/swr-snapshot.js` copies it into `data/swr/` for the SWR tab (one request at a time, 1 s apart, a 30 s timeout and one retry; a failed source is recorded in the file's `errors`):
- `--status` writes `status.json` (3 requests). The deploy job runs it into `_site/data/swr/` on every deploy, so it isn't committed. If SWR is down, the site deploys without it.
- `--weekly` writes `seats/{CRS}.json`, `seats/index.json` and `performance.json` (about 350 requests, 6 minutes). `.github/workflows/swr-weekly.yml` runs it on Mondays at about 05:17 UTC (or by hand), commits `data/swr/` to `main` as github-actions[bot] if anything changed, and then starts `pages.yml`, because a push made with the workflow's own token doesn't trigger workflows. If `main` gets branch protection that blocks the bot, that push fails.
- To try it locally: `node scripts/swr-snapshot.js --weekly --limit 3 --out /tmp/swr` (only the first 3 stations of each list).
- Scheduled runs can start 10–30 minutes late, and GitHub switches schedules off after 60 days without repo activity. The SWR tab shows each snapshot's time.

To check the published file set locally, build `_site/` with the same commands the workflow uses and serve it:

```sh
rm -rf _site && mkdir _site && cp -R index.html css js data _site/ && touch _site/.nojekyll
node scripts/swr-snapshot.js --status --out _site/data/swr
python3 -m http.server 8000 --directory _site
# open http://localhost:8000/?demo
```

If you add a file the page loads from outside `index.html`, `css/`, `js/` and `data/` (an icon, a manifest), add it to the *Stage site files* step in the workflow too.

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
| Route order (to find the previous station in each direction, and for the whole-line strip) | `GET /Line/{id}/Route/Sequence/all` → `orderedLineRoutes[{name, naptanIds}]` (one per branch and direction; names are HTML-encoded, e.g. `Brixton  &harr;  Walthamstow Central`), station names from `stopPointSequences[].stopPoint[]` |
| Live busyness along a whole line (on demand) | `GET /crowding/{naptan}/Live` once per station on the chosen branch: 16 for the Victoria line, 43 for the District line's longest branch. Only when you press **Show whole line**; 3 at a time, cached for 60 s, stopping at the first 429. |
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

**Live crowding along a line.** Press **Show whole line** on an Underground line card to see every station on the line in route order, each with its live busyness (crowding level colour, pips and label, plus the % of baseline). The open station is highlighted and the list scrolls to it. Nothing is requested until you press the button:
- The route comes from `/Line/{id}/Route/Sequence/all`. TfL lists each route once per direction; the dashboard treats a route and its reverse as one branch and keeps only the branches through this station. The longest is shown first, and branching lines (Northern, District, Central, Metropolitan) get a *Branch* menu. For example, King's Cross on the Northern line offers High Barnet ↔ Morden via Bank (32 stations), Edgware ↔ Morden via Bank (31) and Mill Hill East ↔ Morden via Bank (29).
- Each station needs its own `/crowding/{naptan}/Live` request, and the anonymous rate limit is low. So requests go 3 at a time, nearest stations first; answers are cached for 60 seconds and shared between lines and branches (switching the Northern line from the High Barnet to the Edgware branch at King's Cross asked for only the 9 new stations); the open station reuses its reading from the main refresh; and if TfL answers 429, the rest are skipped and the strip suggests adding an app key. The strip isn't refreshed automatically; press *Refresh* for new readings.
- Stations TfL doesn't cover answer `dataAvailable: false` (e.g. Pimlico, Seven Sisters, St. James's Park and Hammersmith District & Piccadilly on 2026-09-27, and Network Rail-run stations such as Harrow & Wealdstone). They show as **No data**, never as 0%.
- It's station busyness, not how full trains are. The button is only on Underground lines because TfL's live crowding covers Underground stations; DLR, Overground, Tram and most Elizabeth line NaPTANs returned `dataAvailable: false`.

**Platform outlook** (lines without loading data) is this dashboard's own heuristic, not a TfL figure. It starts from the station's live level and raises it for disruption on that line (a full step for severe disruption, part of a step for minor delays) and a little when the next train is 8 or more minutes away.

## SWR and National Rail endpoints

The SWR tab's client is `js/swr-api.js`. These sources send `Access-Control-Allow-Origin: *`, so the page calls them directly. Neither SWR's nor Huxley2's API is official or documented, so the page must keep working when either fails.

| Purpose | Endpoint | Used by |
|---|---|---|
| SWR live departures | `GET https://railinfo.southwesternrailway.com/journey/departures/{CRS}` → `{Station, GeneratedAt, Items[{Id, Operator, Platform, ScheduledTime, EstimatedTime, Origin, Destination}], BusItems}`. CRS code only (`/departures/Surbiton` returns 500). `EstimatedTime` is `"On time"`, `"HH:MM"`, `"Delayed"` or `"Cancelled"`; `Platform` may be `null`; `BusItems` are replacement buses (`Platform: "BUS"`). Includes every operator at shared stations (Clapham Junction: SWR, Southern, London Overground). `SwrApi.departures(crs)`, cached 30 s. | S1 |
| SWR calling points | `POST https://railinfo.southwesternrailway.com/journey/services` with `{"ServiceId": "<Id>"}` → `{Destination, LastLocation, Platform, ScheduledDeparture, EstimatedDeparture, ActualDeparture, GeneratedAt, CallingPoints[{Station{Name, CrsCode}, ScheduledTime, EstimatedTime, ActualTime, IsVisited}]}`. The top-level `Destination` is really the station the id belongs to; its row has `ScheduledTime: null` when it's the origin, so its times come from the top-level `*Departure` fields. `ActualTime` is often `"On time"` rather than a time. `SwrApi.service(id)`, cached 30 s per service by S2. | S2 |
| National Rail departures (Huxley2, a community wrapper) | `GET https://huxley2.azurewebsites.net/departures/{CRS}/40` → `trainServices[]` (`serviceID` = railinfo `Id`, `length` in coaches with `0` = unknown, `delayReason`, `cancelReason`, `isCancelled`, `platform`, `operatorCode`), `busServices[]` and `nrccMessages[{value}]` (HTML). `SwrApi.huxleyDepartures(crs)`, cached 30 s so S1 and S3 share one request. | S1, S3 |
| National Rail service (Huxley2) | `GET https://huxley2.azurewebsites.net/service/{serviceID}` → `previousCallingPoints`, `subsequentCallingPoints` (`[{callingPoint: [{locationName, crs, st, et, at, isCancelled, length}]}]`; the first group is this train, others are joining or splitting portions). The id's own station is only in the top-level `sta`/`std`/`etd`/`atd`. `SwrApi.huxleyService(id)`, S2's fallback when railinfo fails. | S2 |
| SWR snapshots published with the site | `GET data/swr/{path}` (written by S7). `SwrApi.snapshot(path)` returns `null` on any failure, and doesn't try when the page is opened from disk. | S3, S4, S5, S6 |
| National Rail planned engineering works (via the snapshot) | `GET https://www.nationalrail.co.uk/engineering-works/` (today) and `GET https://www.nationalrail.co.uk/_next/data/{buildId}/engineering-works.json?date=YYYYMMDD` (other days; `buildId` from today's page). Next.js page data: `engineeringWorks[{slug, summary, startDateTime, endDateTime, operatorsAffectedCollection[{code}], sys{id, publishedAt}}]`, `requestParams{date}`. The HTML page also takes `?date=`, but its CDN cache ignores the query string, so every listing is checked against `requestParams.date`. No CORS, so `scripts/swr-closures.js` reads it during S7's `--status` run and writes `data/swr/closures.json`, refreshed about every 6 hours. | S5 |
| National Rail engineering works notice (via the snapshot) | `GET https://www.nationalrail.co.uk/engineering-works/{slug}-{YYYYMMDD}/` → `plannedIncident{summary, routesAffected, description}` (Contentful rich text). Fetched only for new or changed notices (`publishedAt`). | S5 |
| TfL SWR route sequences (via the snapshot) | `GET https://api.tfl.gov.uk/Line/south-western-railway/Route/Sequence/outbound` → `orderedLineRoutes[{naptanIds}]`: consecutive stops make the track graph used to fill in the stations between the two ends of a closure. | S5 |
| TfL status for SWR | `GET https://api.tfl.gov.uk/Line/south-western-railway/Status` through the shared TfL client (`ctx.tfl`). | S3 |
| SWR service status boards (via the snapshot) | `GET https://www.southwesternrailway.com/api/overallstatus` → `{Status, Summary, LineUpdates[{Summary, Details (HTML), FurtherInfo, UpdatedTime, IncidentId, Colour}]}`; `/api/LiveInformationBoard` → 13 route groups `[{RouteName, StatusText, StatusId}]`; `/api/RainbowBoard` → `{LastUpdated, Lines[{Description, Status, Incidents}]}` per service and direction. No CORS, so the page reads them from `data/swr/status.json` (`SwrApi.snapshot('status.json')`, written by S7). | S3 |
| SWR seat availability, origins (weekly snapshot) | `GET https://www.southwesternrailway.com/api/seatavailability/stations/London%20Waterloo` → `["Addlestone", …, "NOT FOUND", …]` (166 names on 2026-09-27, in SWR's own spelling, e.g. `"Ascot"`, `"Boxhill & Westhumble"`). `NOT FOUND` and London Waterloo itself are skipped. No CORS; fetched by `scripts/swr-snapshot.js --weekly`. | S7 |
| SWR typical busyness per morning train (via the snapshot) | `GET https://www.southwesternrailway.com/api/seatavailability/{fromName}/London%20Waterloo?skip=0&take=100` → `{TotalResults, Items[{Id, Departure "06:28", Arrival "07:04", Via ("-" = none), NumberOfCarriages, Monday…Friday, Mon_TrainName…Fri_TrainName ("Arterio" or "")}]}`. Levels are `"Green"`, `"Amber"`, `"Red"`, `"VeryRed"` or `""`; SWR's own labels (from its [How busy is my train?](https://www.southwesternrailway.com/plan-my-journey/how-busy-is-my-train) page) are "Seats available", "Some seats available", "Standing room only", "Full to capacity" and "No Service". `JourneyDuration` (`"12:34:00 AM"`) isn't a duration, so the journey time comes from `Departure`/`Arrival`. Weekday mornings **into London Waterloo** only (Woking: 43 trains, 06:28–09:28). No CORS, so the page reads `data/swr/seats/{CRS}.json` and `seats/index.json` (`SwrApi.snapshot`, written weekly by S7, which pages while `TotalResults` > 100 and writes a file only for stations with at least one train). | S4 (S7 fetches) |
| SWR station performance, names (weekly snapshot) | `GET https://www.southwesternrailway.com/api/stationperformance/GetStations` → 171 names (e.g. `"Ascot (Berks)"`, `"Box Hill and Westhumble"`). | S7 |
| SWR station performance (via the snapshot) | `GET https://www.southwesternrailway.com/api/stationperformance/{name}?skip=0&take=10` → `{TotalResults, Items[{StationName, CRSCode, TOC, Punctal: "85.00", Cancelled: "3.90"}, …, {StationName: "Wessex route target", CRSCode: "", Punctal: "86.12", Cancelled: "3.68"}], Period: "4-Week Period from 26 July to 22 August", Next3MonthPlan, NextYearPlan, LongTermPlan}`. Numbers are strings; shared stations have one row per operator (`TOC`); some stations have all-zero placeholder rows; `CRSCode` is wrong for a few (Farnham `FCH`, Reading `RDZ`), so the page goes by the snapshot's CRS key. `Punctal` is SWR's punctuality: trains that arrived within 3 minutes of schedule. `/api/stationperformance/GetStations` lists the 171 names. No CORS, so the page reads `data/swr/performance.json` (`SwrApi.snapshot('performance.json')`, written weekly by S7). | S6 (S7 fetches) |
| SWR station list (build time only) | `GET https://www.southwesternrailway.com/api/swrstations` → `[{Name, CrsCode, NationalLocationCode, Latitude, Longitude, Url}]` (204 on 2026-09-27). No CORS, so `scripts/swr-stations.js` fetches it and writes `js/swr-stations.js`. | S0 |
| TfL stops on the SWR line (build time only) | `GET https://api.tfl.gov.uk/Line/south-western-railway/StopPoints` (202 stops) → `naptanId`, `commonName`, `lat`, `lon`, `hubNaptanCode`. Each SWR station is matched to the nearest `910G…` stop within 400 m whose name agrees. The 8 Island Line stations (Brading, Lake, Ryde Esplanade, Ryde Pier Head, Ryde St Johns Road, Sandown, Shanklin, Smallbrook Junction) have no TfL stop. | S0 |

**Station list.** `js/swr-stations.js` is generated, committed, and loaded as a classic script so the page works from disk. Rerun `node scripts/swr-stations.js` by hand when SWR's station list changes (or `--swr file.json --tfl file.json` to use saved responses).

**HTML from SWR and National Rail** (incident details, `nrccMessages`) is never put into the page as HTML. `SwrApi.htmlToText()` turns it into paragraphs of plain text and links, keeping links only when they're `https:` to southwesternrailway.com, nationalrail.co.uk, networkrail.co.uk or tfl.gov.uk, and repairing the broken `http://https://…` links seen in real messages. `SwrApi.renderParagraphs()` builds the DOM from that.

## Project layout

```
index.html          page shell: tab bar, TfL tab, SWR tab
css/styles.css      styles (light + dark themes)
css/swr.css         tab bar and shared SWR tab styles
css/swr-*.css       one file per SWR package (departures, calling-points, status, seats, closures, performance)
js/tfl-api.js       API client and response normalisation (pure helpers are unit-tested)
js/chart.js         SVG busyness profile chart with hover/keyboard tooltip
js/app.js           search, loading, refresh and rendering (TfL tab)
js/demo-data.js     synthetic TfL-shaped responses for ?demo
js/swr-stations.js  SWR stations matched to TfL stops (generated by scripts/swr-stations.js)
js/swr-api.js       SWR / National Rail client, cache, demo routes and shared pure helpers
js/swr-app.js       tab bar, SWR station picker and header, module lifecycle (SwrApp.register)
js/swr-*.js         one file per SWR package, each registering with SwrApp
scripts/            Node scripts: swr-stations.js (run by hand), swr-snapshot.js (run by the workflows), swr-closures.js (swr-snapshot.js's hook for planned closures)
data/swr/           SWR website API snapshots (weekly files committed by swr-weekly.yml)
tests/              node:test unit tests
.github/workflows/pages.yml   test on every push and PR; deploy to Pages when tests pass (and every 15 min)
.github/workflows/swr-weekly.yml   weekly SWR seat and performance snapshot, committed to main
```

Run the tests with `npm test` (Node 18+).
