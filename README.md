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

The site is live at https://jinalharia.github.io/tfl-dashboard/. The workflow in `.github/workflows/pages.yml` runs on every push to `main`, every pull request against `main`, and on demand (*Actions → Test and deploy to Pages → Run workflow*):

- **`test`** runs `npm test` and checks the syntax of every file in `js/`, `tests/` and `scripts/`. Pull requests show it as a check.
- **`deploy`** runs only for a push to `main` or a manual run on `main`, and only if `test` passed. It copies just `index.html`, `css/` and `js/` (plus an empty `.nojekyll`) into `_site/` and publishes that to GitHub Pages. The README, `plan.md`, `tests/`, `package.json` and the workflow itself aren't published.

**One manual step for the repo owner.** In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
- Until that's done, Pages keeps deploying every push straight from `main` (all files, tested or not). The workflow's `deploy` job fails, but the `test` job still runs, so nothing else breaks.
- Once it's switched, a push to `main` is deployed only if the tests pass, and only the site files are published.

To check the published file set locally, build `_site/` with the same commands the workflow uses and serve it:

```sh
rm -rf _site && mkdir _site && cp -R index.html css js _site/ && touch _site/.nojekyll
python3 -m http.server 8000 --directory _site
# open http://localhost:8000/?demo
```

If you add a file the page loads from outside `index.html`, `css/` and `js/` (an icon, a manifest, a data file), add it to the *Stage site files* step in the workflow too.

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
| SWR live departures | `GET https://railinfo.southwesternrailway.com/journey/departures/{CRS}` → `{Station, GeneratedAt, Items[{Id, Operator, Platform, ScheduledTime, EstimatedTime, Origin, Destination}], BusItems}`. CRS code only (`/departures/Surbiton` returns 500). `SwrApi.departures(crs)`, cached 30 s. | S1 |
| SWR calling points | `POST https://railinfo.southwesternrailway.com/journey/services` with `{"ServiceId": "<Id>"}` → `{Platform, ScheduledDeparture, ActualDeparture, GeneratedAt, LastLocation, CallingPoints[]}`. `SwrApi.service(id)`. | S2 |
| National Rail departures (Huxley2, a community wrapper) | `GET https://huxley2.azurewebsites.net/departures/{CRS}/40` → `trainServices[]` (`serviceID` = railinfo `Id`, `length`, `delayReason`, `cancelReason`) and `nrccMessages[{value}]` (HTML). `SwrApi.huxleyDepartures(crs)`, cached 30 s so S1 and S3 share one request. | S1, S3 |
| National Rail service (Huxley2) | `GET https://huxley2.azurewebsites.net/service/{serviceID}` → `previousCallingPoints`, `subsequentCallingPoints`. `SwrApi.huxleyService(id)`. | S2 |
| SWR snapshots published with the site | `GET data/swr/{path}` (written by S7). `SwrApi.snapshot(path)` returns `null` on any failure, and doesn't try when the page is opened from disk. | S3, S4, S6 |
| TfL status for SWR | `GET https://api.tfl.gov.uk/Line/south-western-railway/Status` through the shared TfL client (`ctx.tfl`). | S3 |
| SWR service status boards (via the snapshot) | `GET https://www.southwesternrailway.com/api/overallstatus` → `{Status, Summary, LineUpdates[{Summary, Details (HTML), FurtherInfo, UpdatedTime, IncidentId, Colour}]}`; `/api/LiveInformationBoard` → 13 route groups `[{RouteName, StatusText, StatusId}]`; `/api/RainbowBoard` → `{LastUpdated, Lines[{Description, Status, Incidents}]}` per service and direction. No CORS, so the page reads them from `data/swr/status.json` (`SwrApi.snapshot('status.json')`, written by S7). | S3 |
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
scripts/            Node scripts run by hand (swr-stations.js)
tests/              node:test unit tests
.github/workflows/pages.yml   test on every push and PR; deploy to Pages when tests pass
```

Run the tests with `npm test` (Node 18+).
