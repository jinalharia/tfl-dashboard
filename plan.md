# Dashboard additions: plan and hand-off

Status of additions to the live station crowding dashboard, written so separate agents can each take a work package. Last updated 2026-09-27.

Live site: https://jinalharia.github.io/tfl-dashboard/. Until the repo owner switches the Pages source to *GitHub Actions* (see package D), GitHub Pages deploys `main` from the repo root, about a minute after each merge. After the switch, each merge deploys only if the tests pass.

## Status at a glance

| # | Addition | Status | Package |
|---|---|---|---|
| — | Core dashboard: search, live and typical crowding per entrance group, today chart, line cards with status, train loading, next trains, platform outlook, demo mode, themes | ✅ Done (PR #1) | — |
| 4 | Lift faults and step-free access alerts | ✅ Done (PR #2) | — |
| 3 | "Best time to travel" (quieter-time hint) | ✅ Done (PR #2) | — |
| 1 | Passenger flow by time of day | ✅ Done (PR #2), changed from the proposal (see note) | — |
| 5 | Station facilities panel | ✅ Done (package A) | A |
| 6 | Station-specific disruption notices | ✅ Done (package A) | A |
| 7 | Santander Cycles near the station | ✅ Done (package A) | A |
| 8 | Network-wide status strip | ✅ Done (package B) | B |
| 9 | Planned closures in the next 2 weeks | ✅ Done (package B) | B |
| 2 | Live crowding along a whole line | ✅ Done (package C) | C |
| — | Deploy only when tests pass (GitHub Actions) | ✅ Done (package D); owner must switch the Pages source | D |
| — | Boarding estimate: trains you may need to let go before boarding | ✅ Done (package E) | E |

**South Western Railway tab** (details in [South Western Railway tab](#south-western-railway-tab-packages-s0s7)):

| # | Addition | Status | Package |
|---|---|---|---|
| SWR-9 | Tab bar (TfL / SWR), SWR station picker, shared SWR client | ✅ Done | S0 |
| SWR-3 | Live SWR departures board | ✅ Done | S1 |
| SWR-1 | Train length on each departure, short-train warning | ✅ Done | S1 |
| SWR-7 | Delay and cancellation reasons on each departure | ✅ Done | S1 |
| SWR-8 | Where is my train (calling points) | ✅ Done | S2 |
| SWR-4 | SWR overall status (headline) | ✅ Done | S3 |
| SWR-5 | Status by route group | ✅ Done; waiting for S7 snapshots in production | S3 |
| SWR-6 | Incident details (ticket acceptance, replacement buses) | ✅ Done; waiting for S7 snapshots in production | S3 |
| SWR-2 | Typical busyness per morning train into Waterloo | ✅ Done; waiting for S7 snapshots in production | S4 |
| SWR-10 | SWR planned closures, next 14 days (investigate first) | ⬜ Not started | S5 |
| SWR-11 | Station punctuality and cancellations | ⬜ Not started | S6 |
| — | Scheduled snapshots of SWR data that browsers can't fetch directly | ⬜ Not started | S7 |

**Note on #1.** The proposal was "entry/exit footfall", but TfL's `passengerFlows` are about 10 *unlabelled* values per 15-minute slice, so they can't be split into entries and exits. What shipped is **typical passenger flow per line**: the per-slice sum, charted on each line card. TfL gives one profile for all days and it follows a weekday pattern, so the card says so at weekends.

**Out of scope** (considered and rejected: they don't help someone deciding whether a station is too busy): air quality, road disruptions, car parks, accident stats. For SWR, also: other train operators' status, an A-to-B journey planner, and the clickable network map from `/api/sitecore/Interactive/GetDesktopView` (a 1.3 MB HTML/SVG fragment, not data).

## Work packages

Packages A, B and C can run in parallel. Each one touches `js/app.js`, `index.html` and `css/styles.css`, so keep changes to **new** functions and **new** page sections, and merge `main` into your branch before opening a PR. Resolve conflicts by keeping both sides; each package adds its own section.

### Package A: station information (items 5, 6, 7)

**Status: ✅ done.** A "Station information" section below the tiles has station notices, a facilities card and a Santander Cycles card. It's **off by default** behind a "Station information" toggle next to Auto-refresh (`#show-station-info`, remembered in `localStorage` as `tfl.showStationInfo`). While it's off, none of its requests are made; turning it on loads it for the open station. Notes from building it:
- `getStation()` now also returns the raw stop as `station.stop`.
- `/StopPoint/940GZZLUKSX` returns the `HUBKGX` hub. Its National Rail children (`910GKNGX`, `910GSTPXBOX`) have their own facility values, and they're shown as a separate "National Rail" group. Stratford's three children list identical values, so they're merged into one group, and the card says so.
- `NearestPlaces` lists docks in **id order, not distance order**. To pick the nearest 5, one static `/Place?type=BikePoint&lat&lon&radius=800` request per station gives `places[].distance`. If it fails, docks show in listed order without distances.
- Notices whose `toDate` has passed are hidden. Future ones are marked "Starts …".

One "Station information" section below the tiles, loaded when a station is selected. Items 5 and 7 don't need refreshing; refresh item 6 with the live data every 60 s, or every 5 minutes if you add your own timer.

**5. Facilities.**
- **Data:** the `/StopPoint/{id}` response `getStation()` already fetches. Currently only the built station model is kept, so return or keep the raw stop too.
- **Where the data is:** `additionalProperties` entries with `category: "Facility"`. For hubs (e.g. `HUBSRA`) the useful values are on the **children** (`940GZZLUSTD`, `910GSTFD`, `940GZZDLSTD`), so collect per child and label them by network like the tiles do. Examples of what's there: King's Cross `Lifts=10`, `Escalators=19`, `Toilets=no`, `WiFi=yes`; Stratford Underground `Lifts=5`, `Toilets=yes`. Also useful: `category: "VisitorCentre"` (`Location`) and `category: "Address"` (`PhoneNo`).
- **Show:** lifts, escalators, toilets, Wi-Fi, cash machines, ticket halls, help points. Skip odd keys like payphones and photo booths.

**6. Station disruption notices.**
- **Endpoint:** `GET /StopPoint/{id}/Disruption?getFamily=true&flattenResponse=true`, with **one id per call** (the hub or station id). A comma list of ids plus `getFamily` returns `ApiArgumentException`.
- **Response:** a flat array of `{atcoCode, commonName, type, appearance, description, fromDate, toDate, additionalInformation, mode}`. At Stratford on 2026-09-27 it returned 4 items, 3 of them **identical duplicates**, so de-duplicate on `description` + `fromDate`.
- **Show:** each unique notice with its dates, e.g. `type: "Part Closure"`, `appearance: "PlannedWork"`. Hide the section when the list is empty. Keep it separate from the lift banner.

**7. Santander Cycles nearby.**
- **Nearby docks:** the station response lists them as `additionalProperties` with `category: "NearestPlaces"`, `key: "SourceSystemPlaceId"`, and values like `BikePoints_14`. King's Cross lists 10. Check children too for hubs.
- **Live availability:** `GET /Occupancy/BikePoints/{ids}` (comma list, one request) → `[{id, name, bikesCount, standardBikesCount, eBikesCount, emptyDocks, totalDocks}]`. For example, `BikePoints_4` "St. Chad's Street, King's Cross" had 12 bikes (1 e-bike) and 7 empty docks.
- `/BikePoint/Search?query=Oxford Circus` returned **nothing**, so use the station's `NearestPlaces` list, not search.
- **Show:** the nearest 3–5 docks with bikes and e-bikes available and free docks. Refresh with the live data.

**Tests for A:** add pure helpers to `js/tfl-api.js` (e.g. `stationFacilities(stop)`, `nearbyBikePointIds(stop)`, `normalizeStationDisruptions(raw)`), with unit tests using the response shapes above.

### Package B: network status (items 8, 9) ✅ done

**Built:** a network status strip under the top bar (`networkStatusList()`, refreshed on its own 60 s timer, which follows the Auto-refresh switch once a station is open) and a "Planned closures in the next 14 days" section below the line cards (`upcomingClosures()`, `closureDateRange()`, `formatPeriod()`). Checked against the live API on 2026-09-27: 11 of 20 lines were disrupted, and the range call returned a live incident (Victoria Minor Delays, `disruption.category: "RealTime"`) and repeated DLR entries as well as planned works, so the helper drops live incidents that have already started and de-duplicates. Note that `validityPeriods[].isNow` was `false` even for the Central line closure that was running, so the helper compares dates instead.

**8. All-lines status strip.**
- **Endpoint:** `GET /Line/Mode/tube,elizabeth-line,dlr,overground,tram/Status`. One request returned 20 lines, each with `lineStatuses[]`, the same shape `normalizeStatuses()` already handles.
- **Show:** a compact strip under the top bar with line colour, name and status icon. Colours are in `LINE_COLOURS` in `js/tfl-api.js`. Put lines with problems first. Clicking a line could filter the quick picks, but that's optional.
- **Note:** show it even before a station is chosen, and refresh with the live timer, or on its own 60 s timer when no station is loaded.

**9. Planned closures (next 14 days) for this station's lines.**
- **Endpoint:** `GET /Line/{ids}/Status/{startDate}/to/{endDate}` with dates as `YYYY-MM-DD`. Each `lineStatuses[]` entry has `validityPeriods[{fromDate, toDate}]` and a `reason`. For example, on 2026-09-27 the Central line showed `Part Closure` valid 2026-09-26T03:32Z → 2026-09-28T00:29Z.
- **Show:** only entries that start in the future, or are planned works, grouped by line on each line card or in a "Coming up" list. Drop the current `Good Service` entries.
- **Tests:** a pure helper to filter and sort upcoming entries, with unit tests.

### Package C: live crowding along a line (item 2)

**Status: ✅ done.** Each Underground line card has a **Show whole line** button. It opens a ladder of the line's stations in route order, each with its crowding level (status colour, pips, label and %), the open station highlighted and scrolled into view. Nothing is requested until the button is pressed. Notes from building it (checked against the live API on 2026-09-27, a Sunday afternoon):
- **Branches:** `lineBranches()` keeps the `orderedLineRoutes` through the station, merges each route with its reverse (TfL lists both directions), and sorts longest first. Branching lines get a *Branch* menu. Northern at King's Cross: High Barnet ↔ Morden via Bank (32), Edgware ↔ Morden via Bank (31), Mill Hill East ↔ Morden via Bank (29); the Charing Cross routes don't call there. District at Earl's Court: Ealing Broadway ↔ Upminster (43) first. Route names are HTML-encoded (`&harr;`, double spaces), so `cleanRouteName()` tidies them.
- **Requests:** `mapLimit()` sends 3 at a time, in `outwardOrder()` from the open station, so nearby stations fill first. `lineLive()` in `js/app.js` caches each station's answer (including "no data") for 60 s, shared across lines and branches, and reuses the main refresh's reading for the open station. Measured: Victoria from Oxford Circus 15 requests, never more than 3 in flight; closing and reopening, or pressing Refresh, within 60 s made 0; Northern at King's Cross 31, then switching to the Edgware branch 9 (only the new stations); Waterloo & City from Waterloo 1 (Bank was cached); District at Earl's Court 42.
- **429:** simulated by answering 429 from the 6th live request. The strip stops sending, marks the rest "Not loaded", and shows "TfL's rate limit was reached … Add an app key in Settings" (a button that opens Settings). The rest of the page was unaffected.
- **No data:** stations TfL doesn't cover answer 200 with `dataAvailable: false` and `percentageOfBaseline: 0` (Pimlico, Seven Sisters, St. James's Park, Hammersmith D&P, Kensington (Olympia) on that day), so they show "No data", never 0%. DLR, Tram, Overground and Elizabeth line NaPTANs checked (`940GZZDLBNK`, `940GZZCRWIM`, `910GHGHI`, `910GLIVST`) all had no data, so the button is only on Underground (`mode: tube`) cards.
- **Not auto-refreshed:** refreshing an open District strip every minute would be 40+ requests a minute on the shared anonymous limit, so the strip has its own *Refresh* link instead. When the line itself is closed (Waterloo & City on Sundays: "Planned Closure") the strip says so; the station readings still show.
- **Possible follow-up:** "busier/quieter than usual" per station (one more `/crowding/{naptan}/{day}` request each, cacheable for the day).

- **Route:** `GET /Line/{id}/Route/Sequence/{outbound|inbound}` → `{stations[], orderedLineRoutes[{name, naptanIds[]}], stopPointSequences, ...}`. The Victoria line outbound had 1 ordered route of 16 NaPTANs (`940GZZLUBXN` → …). Branching lines such as the Northern and District have several `orderedLineRoutes`, so pick the longest, or let the user choose a branch.
- **Crowding:** `GET /crowding/{naptan}/Live` per station, which is **one request per station** (16 for Victoria, 60+ for the District line). TfL's anonymous rate limit is low, so:
  - load it only on demand (a "Show whole line" button on a line card)
  - send the requests a few at a time, not all at once
  - cache the results for about 60 s
  - show a hint to add an app key if a 429 comes back.
- **Show:** a strip or ladder of stations along the line, each coloured and labelled by crowding level (use `crowdingLevel()` for the label and the status colours), with the selected station highlighted. Stations with no data (DLR, Network Rail-run stations) should show as "no data", not zero.
- **Tests:** a pure helper that turns a route sequence into an ordered station list, with unit tests.

### Package D: tested deploys ✅ done

**Status: ✅ done, waiting on one manual step by the repo owner.** `.github/workflows/pages.yml` runs on push to `main`, on pull requests against `main`, and on `workflow_dispatch`.
- **`test`** job: checkout, Node LTS (`lts/*`), `npm test`, then `node --check` on each file in `js/` and `tests/`. It runs on PRs too, so they get a visible check.
- **`deploy`** job: `needs: test`, and runs only for a push to `main` or a manual run on `main`. It stages `index.html`, `css/` and `js/` plus an empty `.nojekyll` into `_site/`, then runs `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`. It has `pages: write`, `id-token: write` and `contents: read`, the `github-pages` environment with the page URL, and a `pages` concurrency group that lets a running deploy finish.

**Manual step (repo owner):** in **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
- Until then, Pages keeps deploying every push straight from `main`, with all files and whether or not the tests pass. The `deploy` job fails, but the `test` job still runs, so nothing else breaks.
- After the switch, a push to `main` deploys only if the tests pass, and only the site files are published. The README, `plan.md`, `tests/` and `package.json` stop being public.

Notes from building it:
- Action versions, checked against each repo's tags on 2026-09-27: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`.
- `node --check a.js b.js` checks **only `a.js`**; the rest become script arguments. So the workflow loops over the files one at a time.
- `upload-pages-artifact` leaves out dotfiles unless `include-hidden-files: true`, so the workflow sets that to keep `.nojekyll`. (A deploy from Actions doesn't run Jekyll anyway; `.nojekyll` is a belt-and-braces guard.)
- The page loads only `css/styles.css` and the four `js/` files, so `index.html`, `css/` and `js/` are the complete site. Checked by loading `_site/index.html?demo` (and `?demo&station=HUBSRA`) in headless Chromium: no console errors and no failed requests. A new asset outside those folders must be added to the *Stage site files* step.
- `_site/` is in `.gitignore`.

### Package E: boarding estimate ✅ done

**Question:** how many trains might you have to let go before you can board, given how crowded the station is?

**Built:** a per-direction "Boarding estimate*" on each Underground line card. Where it's available, it replaces the older platform outlook and the relative loading bars.

**Data (all checked against the live API on 2026-09-27):**
- **Loading scores:** `/StopPoint/{naptan}/Crowding/{line}?direction=all` → `lines[].crowding.trainLoadings[]` with `lineDirection` (NB/SB/EB/WB), `naptanTo` (next station), `timeSlice` and `value`. Scores run **0–6**; 6 was seen on Bank → Waterloo at 17:45. Each station's rows are the load **leaving** it towards `naptanTo`.
- **Route order:** `/Line/{id}/Route/Sequence/all` → `orderedLineRoutes[].naptanIds`, one list per direction and branch. For names, use `stopPointSequences[].stopPoint[]`; `stations[]` uses hub ids (`HUBBAN`) at interchanges.
- **Arriving load:** the row of the station *before this one in the direction of travel*, whose `naptanTo` is this station. When this station is first in the route, the train arrives empty. Example: the Waterloo & City line at Waterloo eastbound and at Bank westbound. Note that the Bank → Waterloo row is full at 17:45, but it belongs to the westbound train that empties at Waterloo, so it must not be used for eastbound boarders.

**Model** (`boardingEstimate()` in `js/tfl-api.js`):
- `d` = departing score ÷ 6, `a` = arriving score ÷ 6 (0 when the train starts here).
- Boarders = max(d − a×0.7, 0.3×d), assuming 30% alight. Room = 1 − (d − boarders).
- Ratio = boarders × (live ÷ typical busyness) × service factor ÷ room, with ×1.5 for severe disruption, ×1.2 for minor delays, and ×1.2 if the next train is 8+ minutes away.
- If d is full (score 6), the ratio is at least the busyness and service factors.
- Bands: < 0.85 board the first train, ≤ 1 tight, ≤ 2 let 1 go, > 2 let 2+ go.
- When the line isn't running (closure status and no arrivals), the card says so instead of estimating.

**Results on real data** (weekday profile):
- Waterloo & City at Waterloo, 08:15 eastbound: arrives empty and leaves 4/6 full, so "Board the first train". It becomes "tight" if Waterloo is 50% busier than usual.
- Waterloo & City at Bank, 17:45 westbound: leaves full, so "tight", or "let 1 train go" when Bank is 30% busier than usual.
- Central at Liverpool Street, 08:15 westbound: arrives full from Bethnal Green, leaving 30% room, so "tight".

**Caching:** route sequences and other stations' loadings are static, so `loadBoardingInputs()` in `js/app.js` caches them for the session. That's about 1 + (number of previous stations) extra requests per line, the first time a line is seen.

**Possible follow-ups (not started):**
- Calibrate the 30% alighting assumption per station using `passengerFlows`, once its values can be identified.
- Use live gaps between predicted trains, instead of only the first train's wait, for the service factor.
- On branching lines, weight previous stations by frequency instead of taking the fullest.

## South Western Railway tab (packages S0–S7)

Everything about South Western Railway (SWR) goes on its own **SWR** tab. The existing page becomes the **TfL** tab and keeps working unchanged. Items are numbered SWR-1 to SWR-11, following the list of ideas agreed on 2026-09-27.

### Who can start when

```
Start now:          S0 tab shell + stations      S7 snapshots pipeline
Start now, but wire  S1 departures ─┬─ S2 calling points (listens to S1's event)
into the page only   S3 status      │
after S0 is merged:  S4 seats  S5 closures (investigate first)  S6 performance
                     S3, S4, S6 use demo fixtures until S7 publishes data
```

- **S0 and S7 start straight away.** S0 is kept small so it merges first.
- **S1 to S6 can start at the same time.** Each begins with its pure helpers, test fixtures and unit tests, which don't need S0. Merge `main` in once S0 is there, then wire up the page.
- **S3, S4 and S6** read files that S7 publishes. Until S7 is merged, build and test them against the demo fixtures and the file formats in [the S7 contract](#snapshot-file-formats-s7-writes-s3-s4-s6-read).
- **S2** attaches to S1's departure rows through an event (see [the S0 contract](#what-s0-provides-the-contract-for-s1s6)). It can be built against a fake event and checked end to end once S1 is merged.
- **One file set per package** keeps parallel PRs from conflicting. S0 creates an empty stub for every package's JS and CSS file and adds its `<script>`/`<link>` tag and its `<section>` to `index.html`. From then on, a package edits only its own files, apart from appending rows to the README endpoint table and this file's status table. When those two conflict, keep both sides.

### SWR data sources (all checked on 2026-09-27)

Browsers can call only sources that send `Access-Control-Allow-Origin`. The others go through S7's snapshots.

| Source | Endpoint | CORS | What it gives |
|---|---|---|---|
| SWR live train info | `GET https://railinfo.southwesternrailway.com/journey/departures/{CRS}` (also `/arrivals/{CRS}`) | ✅ `*` | `{Station{Name,CrsCode}, GeneratedAt, Items[], BusItems[]}`. Each item: `Id` (e.g. `9138693WATRLMN_`), `Operator`, `Platform` (may be `null`), `ScheduledTime` `"19:21"`, `EstimatedTime` (`"On time"`, `"19:45"`, `"Cancelled"`, `"Delayed"`), `Origin`/`Destination {Name, CrsCode}`. Takes the **CRS code** only: `/departures/Surbiton` returned 500. Clapham Junction returned 100 items from 3 operators (60 SWR, 32 Southern, 8 London Overground). `BusItems` (replacement buses) was empty on the day. |
| SWR calling points | `POST https://railinfo.southwesternrailway.com/journey/services` with body `{"ServiceId": "<Id>"}` | ✅ `*` | `{Platform, ScheduledDeparture, ActualDeparture, GeneratedAt, LastLocation, CallingPoints[{Station{Name,CrsCode}, ScheduledTime, EstimatedTime, ActualTime, IsVisited}]}` |
| Huxley2 (community JSON wrapper for National Rail's live train data) | `GET https://huxley2.azurewebsites.net/departures/{CRS}/{rows}` and `/service/{serviceID}` | ✅ `*` | `trainServices[]` with `serviceID` (**the same value as railinfo's `Id`**, so rows can be joined), `std`, `etd`, `platform`, `operatorCode` (`SW`), **`length`** (coaches; `0` = unknown; 3, 6, 8, 10 and 12 seen), `delayReason`, `cancelReason`, `isCancelled`. Also `nrccMessages[{value}]` (HTML disruption messages for the station). `length` is present without `?expand=true`. `formation` (coach loading) was `null` for every SWR train. The service is run by a volunteer, so treat it as optional: the page must work without it. |
| TfL | `GET /Line/south-western-railway/Status`, `/Line/south-western-railway/StopPoints`, `/Line/south-western-railway/Route/Sequence/{dir}` | ✅ `*` | One status for all of SWR (on the day `Special Service`, with `reason` holding a nationalrail.co.uk link); 202 stops with `910G…` ids; 36 routes. There's no crowding (`/crowding/910GWATRLMN/Live` → `dataAvailable: false`), and `/StopPoint/{id}/ArrivalDepartures?lineIds=south-western-railway` is rejected as `line id … is invalid`. |
| SWR website API | `GET https://www.southwesternrailway.com/api/…` | ❌ none | Status boards, incidents, seat availability, station performance and the station list (details in S3, S4, S6 and S7). Undocumented and used by the SWR website, so it may change without notice. |

**Not usable:**
- **Per-coach occupancy** (`railinfo…/api/TrainOccupancy/trainoccupancy`) returns 404.
- **Live car parks** (`/api/LiveCarParking/*`) hung until the 30–40 s timeout and needs a token.
- **`swrapi.southwesternrailway.com`** answers 403 without the SWR website's own API key. Don't copy that key into this repo.
- **The official National Rail feed** (OpenLDBWS, via Rail Data Marketplace) needs a registered token and sends no CORS headers, which is why Huxley2 is used.

### What S0 provides (the contract for S1–S6)

S0 builds exactly these names, so the other packages can code against them before S0 merges.

- **Files:**
  - `js/swr-api.js`: the client and shared pure helpers (`window.SwrApi`, and `module.exports` in Node).
  - `js/swr-stations.js`: the generated station list (`window.SWR_STATIONS`, and `module.exports`).
  - `js/swr-app.js`: the tab controller (`window.SwrApp`).
  - `css/swr.css`: shared SWR styles.
  - Stubs that the packages fill: `js/swr-departures.js` (S1), `js/swr-calling-points.js` (S2), `js/swr-status.js` (S3), `js/swr-seats.js` (S4), `js/swr-closures.js` (S5) and `js/swr-performance.js` (S6), each with its own `css/swr-<name>.css`.
- **Script order in `index.html`**, after `js/app.js`: `swr-stations.js`, `swr-api.js`, `swr-app.js`, then the six package files. `SwrApp` starts on `DOMContentLoaded`, which comes after every classic script has run, so all modules have registered by then.
- **Station object** (one per `SWR_STATIONS` entry): `{crs: 'WAT', name: 'London Waterloo', nlc: '5598', lat, lon, naptan: '910GWATRLMN' | null, tflHub: 'HUBWAT' | null, url: '/travelling-with-us/at-the-station/…'}`.
- **Module registration:** every package file ends with `if (typeof window !== 'undefined' && window.SwrApp) SwrApp.register({...})`:
  ```js
  SwrApp.register({
    id: 'departures',                 // renders into <section id="swr-departures">, which S0 creates hidden
    onStation(station, ctx) {},       // a station was chosen; show the section if there's something to show
    refresh(station, ctx) {},         // every 60 s while the SWR tab is visible and its Auto-refresh is on, and on "Refresh now"
  });
  // ctx = { api: SwrApi, tfl: TflApi client (shares the Settings app key), esc, demo: bool, token }
  // token changes whenever the station changes; drop late responses whose token is stale, like loadStation() does.
  ```
  Section ids: `swr-status`, `swr-departures`, `swr-seats`, `swr-closures`, `swr-performance`. They're in that order in the page, and each is hidden until its module shows it. S2 has no section of its own.
- **Fetch wrappers in `SwrApi`** (all return parsed JSON or throw; demo mode routes them to fixtures):
  - `departures(crs)` → railinfo departures, cached 30 s.
  - `service(id)` → railinfo `/journey/services`.
  - `huxleyDepartures(crs)` → Huxley departures (40 rows), cached 30 s and **shared by S1 and S3**, so one request serves both.
  - `huxleyService(id)`.
  - `snapshot(path)` → `fetch('data/swr/' + path)`. It returns `null` on any failure, including opening `index.html` from disk. S4 and S6 must still render their section when it's `null` (as "not available here"), not throw.
  - `cached(key, ttlMs, fn)`.
- **Shared helpers:**
  - `htmlToText(html)`: SWR and National Rail send HTML in incident details and messages. It parses with `DOMParser`, or a regex fallback in Node, and returns plain paragraphs. Links are kept only if they're `https:` to `southwesternrailway.com`, `nationalrail.co.uk`, `networkrail.co.uk` or `tfl.gov.uk`. The real data contains broken links such as `http://https://www.nationalrail.co.uk/…`; repair or drop them. Never put API HTML into `innerHTML`.
  - `parseUkTime(str)`: accepts `"19:21"`, `"19:18:22 27/09/2026"` (Europe/London) and ISO strings.
  - `stationByCrs(crs)`.
  - `SwrApi.demoRoutes.push(fn)`: packages add their demo fixtures to this list from their own file.
- **Event for S2:** S1 renders each departure with a `button.swr-dep-more[data-service-id]` and an empty `div.swr-dep-detail[data-service-id]`. When a row is opened, S1 dispatches `document.dispatchEvent(new CustomEvent('swr:service-open', {detail: {serviceId, crs, container}}))`. After each re-render, S1 re-dispatches it for rows that are still open, so a refresh doesn't close them.

### Package S0: tab shell, SWR station picker and shared client (item SWR-9)

**Status: ✅ done.** Notes from building it (checked on 2026-09-27 in headless Chromium, in `?demo` and against the live APIs through `page.route` + `curl`):
- **Additions to the contract** (all optional or extra; nothing in it was renamed):
  - Modules may also have `init(ctx)`, called once when the SWR tab is first opened, before any `onStation`. S3 can use it to show the TfL headline before a station is chosen. `onStation` and `refresh` always get a station, never `null`.
  - `ctx.isStale()` is true once the station has changed since that `ctx` was made (the same test as comparing `ctx.token` with `SwrApp.token()`).
  - Return a promise from `onStation`/`refresh`: the header's "Updated …" time is set when every module's promise has settled. A module that throws is logged with `console.error` and doesn't stop the others.
  - `SwrApp` also has `open(crs)`, `selectTab('tfl'|'swr')`, `refresh()`, `station()`, `token()` and `tab()`. Switching tabs dispatches `dashboard:tabchange` (`detail.tab`) on `document`.
  - `SwrApi` also has `renderParagraphs(paragraphs)` (a `DocumentFragment` of `<p>` and safe `<a>`), `safeHref(url)`, `searchStations(q)`, `stations()`, `swrStationForTflStop(stop)`, `normalizeCrs()`, `tabState(search, storedTab)`, `tabSearch(search, changes)`, `createDemoFetch(fallback)`, `configure({fetch, demo})`, `clearCache()` and `isDemo()`.
- **`htmlToText(html)`** returns `[{text, parts, links}]`, one entry per paragraph. `text` is the plain text, with `\n` for a single `<br>`. `parts` is `[{text}, {text, href}, …]` in order, for building DOM. `links` is `[{text, href}]`. Paragraphs come from block elements and from blank lines (`<br><br>`, which is how SWR's `Details` separates "What's going on" and so on). Unsafe links keep their text without the link, and bare safe `https://` URLs in the text (SWR's `FurtherInfo`) become links. The DOMParser and regex paths give identical output on every real sample.
- **Demo routes** are `(url, options) => body | null`. `url` is the full request URL, or `data/swr/<path>` for snapshots; `options` is the fetch init (`method: 'POST'`, `body` for `service()`). In `?demo`, `ctx.tfl` also asks `SwrApi.demoRoutes` first and then falls back to the TfL demo data, so S3 can add a route for `https://api.tfl.gov.uk/Line/south-western-railway/Status`. The TfL demo's Waterloo hub now has a `910GWATRLMN` child on the `south-western-railway` line, so "SWR trains from here" shows there.
- **Station list:** 204 SWR stations, 196 matched to a TfL stop, 6 with a TfL hub (Waterloo, Vauxhall, Clapham Junction, Wimbledon, Richmond and Hampton Court, whose `HUBHAM` has no TfL-tab lines). No TfL stop for the 8 Island Line stations: Brading, Lake, Ryde Esplanade, Ryde Pier Head, Ryde St Johns Road, Sandown, Shanklin and Smallbrook Junction. The name check needs every word of the shorter name to be in the longer one, after dropping brackets and "Rail Station": sharing a first word isn't enough, because Windsor & Eton Riverside is 376 m from Windsor & Eton Central. Where two stops share a point (Reading's `910GRDNGSTN` and `910GRDNG4AB`), the one with more lines wins, so Reading gets the stop with the Elizabeth line.
- **"Open in TfL tab"** shows, as specified, for every station with a `naptan` or `tflHub`. For SWR-only stations such as Surbiton, the TfL tab then says the station isn't served by the Underground, Elizabeth line, DLR, Overground or Tram. Showing it only for hubs and Reading would need one more field on the station object.
- **Layout:** both search boxes stay in the top bar, in the same place, and each shows only on its own tab, so the TfL tab looks exactly as before. The SWR quick picks, header and sections are in `#tab-swr`. `#swr-status` comes before the station header, because it's shown before a station is chosen.
- **Pausing:** `js/app.js` now starts on `DOMContentLoaded`, after `js/swr-app.js` has applied the tab, so a page opened with `?tab=swr` makes no TfL requests at all (the network strip and any `?station=` load the first time the TfL tab is shown). While the SWR tab shows, the TfL station and network-strip ticks are skipped. Measured with Playwright's clock: 61 s on the SWR tab made 0 TfL requests, and switching back made the catch-up requests at once. The SWR tab's 60 s tick likewise runs only while it's showing. Charts are redrawn when the TfL tab is shown, because a hidden panel has no width to measure.
- **Live check:** a probe module loaded 55 Waterloo departures from railinfo, 40 from Huxley, 17 calling points from `POST /journey/services` (the CORS preflight allows `Content-Type`), and TfL's SWR status ("Special Service") through `ctx.tfl`. Calling `departures('WAT')` twice made one request. `snapshot()` returns `null` from disk without calling `fetch`, because Chromium logs an error for `fetch('file:…')`.

**Goal:** a tab bar under the top bar with **TfL** and **SWR**, and an SWR panel where you pick an SWR station. The TfL tab looks and behaves exactly as it does today.

- **Tabs:**
  - Markup: `role="tablist"`, arrow-key navigation, `aria-selected`.
  - The existing content (search, network strip, quick picks, `#content`) moves into `#tab-tfl`, and the new `#tab-swr` sits next to it. The TfL search box shows only on the TfL tab.
  - URL: `?tab=swr&swr=WAT` opens the SWR tab at Waterloo. `?station=` keeps working for TfL. The last tab is remembered as `localStorage['tfl.tab']` (wrapped in the existing `store`).
  - When the TfL tab is hidden, pause its station refresh and its network-strip timer (a small change in `js/app.js`: skip the tick while hidden, catch up when shown). This saves TfL rate limit. No SWR request is made until the SWR tab is first opened.
- **Station list:**
  - `scripts/swr-stations.js` (Node, no dependencies) fetches `GET https://www.southwesternrailway.com/api/swrstations` (204 stations: `Name`, `CrsCode`, `NationalLocationCode`, `Latitude`, `Longitude`, `Url`) and `GET https://api.tfl.gov.uk/Line/south-western-railway/StopPoints` (202 stops).
  - It matches them by nearest coordinates (within about 400 m), checked against the name, and writes `js/swr-stations.js`.
  - Stations with no TfL match get `naptan: null`. The Island Line stations are the likely ones; list whatever doesn't match in the PR.
  - The list is a committed JS file, not JSON, so it works when `index.html` is opened from disk. Rerun the script by hand when SWR's station list changes.
- **Picker:**
  - A search box over `SWR_STATIONS`, matching name or CRS code with the same keyboard behaviour as the TfL search.
  - Quick picks: London Waterloo, Vauxhall, Clapham Junction, Wimbledon, Surbiton, Richmond, Woking, Guildford.
  - A station header with the name, CRS code and an "Updated …" time, plus an Auto-refresh (60 s) toggle (`swr.autoRefresh`) and "Refresh now".
  - This makes every SWR-only station (Surbiton, Woking, …) searchable, which is item SWR-9.
- **Links between the tabs:**
  - An SWR station with a `tflHub` or `naptan` (e.g. Waterloo, Vauxhall, Wimbledon, Richmond) shows "Open in TfL tab".
  - A TfL station whose stop has an SWR `910G` child shows "SWR trains from here" (the `south-western-railway` line id is in `/StopPoint/{id}` `lines[]`; Waterloo has it). Keep this as one small addition to `renderLines()` or the station header.
- **Demo:** `?demo` works on the SWR tab. `SwrApi` routes the railinfo, Huxley and snapshot URLs to `SwrApi.demoRoutes`. S0 supplies none itself; each package brings its own.
- **Deploy:** `node --check` in `pages.yml` also loops over `scripts/*.js`.
- **Tests:** `tests/swr-api.test.js` covers `htmlToText` (use the real `nrccMessages` and `LineUpdates[].Details` samples, including the `http://https://` link), `parseUkTime`, the station matching (fixture: 3 swrstations entries plus 3 TfL stops, from the endpoints above) and the URL/tab state parsing.

### Package S1: live departures with train length and delay reasons (items SWR-3, SWR-1, SWR-7)

**Status: ✅ done.** Notes from building it (checked on 2026-09-27, a Sunday evening, in headless Chromium at 390 px in light and dark, in `?demo` and against the live APIs through `page.route` + `curl`):
- **The join works.** With both requests made within a second, every Huxley row matched a railinfo `Id` (Waterloo 40 of 55, Clapham Junction 40 of 100, Surbiton 37 of 38). The rest are beyond Huxley's 40 rows and show "Length unknown", the same as `length: 0`. At Clapham Junction the 40 Huxley rows cover only about the next 25 minutes, because two-thirds of them are other operators'.
- **The two sources can disagree.** railinfo is the board, so its time, status and platform win. Huxley only fills a `null` platform. One Waterloo train was on platform 3 in railinfo and platform 5 in Huxley. A train is shown as cancelled if either source says so.
- **Real values seen:** `EstimatedTime` was `"On time"`, `"HH:MM"`, `"Delayed"` or `"Cancelled"`, and `classifyEstimate()` shows anything else as grey text. Late by 1–4 minutes is amber and 5 or more orange. Lengths were 0, 3, 4, 6, 8, 10 and 12. Delayed trains stay on the board after their scheduled time (18:53 at 19:42).
- **Other operators:** SWR is `operatorCode` `SW` or `IL`, or `Operator` "South Western Railway" / "Island Line" when railinfo is on its own. The hidden count names the other operators ("38 trains by Southern and London Overground hidden").
- **Replacement buses:** railinfo `BusItems` (Surbiton had 4 to Berrylands on the day), or Huxley `busServices` when railinfo fails, go in a separate list with no coaches.
- **Failures:**
  - Huxley down: a "Train length unavailable" note, and no lengths or reasons.
  - railinfo down: the board comes from Huxley alone, with a note.
  - Both down on a refresh: the last list stays, with "Couldn't refresh; showing the list from HH:MM".
- **Row contract:** on refresh, S1 moves each open `div.swr-dep-detail` node (and whatever S2 put in it) into the new markup, then re-dispatches `swr:service-open` with that same container, so an open list doesn't flicker or close. A row that has left the board is dropped from the open set. Late responses are dropped with `ctx.isStale()` plus a sequence counter, so an older refresh can't overwrite a newer one.
- **Demo:** `SwrDepartures.demoRoute` answers railinfo `/journey/departures/{CRS}` and Huxley `/departures/{CRS}/{rows}` for any station. There are hand-made boards for WAT, CLJ (other operators) and SUR (buses), with times shifted to now, and a generic board elsewhere named from `stationByCrs`. The Huxley body carries the real `nrccMessages` (including the `http://https://` link) for WAT and CLJ, so S3 uses the same route.
- **Pure helpers** are exported for tests: `normalizeDepartures(railinfo, huxley, {allOperators, limit})`, `classifyEstimate`, `minutesBetween` and friends, and `renderBoard()`, which returns an HTML string so the markup contract and escaping are tested in Node.

**Question:** when is the next train, which platform, is it on time, and is it a short train that will be packed?

- **Data:**
  - `SwrApi.departures(crs)` (railinfo) is the board.
  - Enrich it from `SwrApi.huxleyDepartures(crs)` by joining railinfo `Id` = Huxley `serviceID`. Huxley gives `length`, `delayReason`, `cancelReason` and a platform when railinfo's is `null`.
  - If Huxley fails, show the board without those fields and say "Train length unavailable". If railinfo fails, build the board from Huxley alone.
- **Show:**
  - The next 10–15 departures: time, expected time (on time / late / cancelled, in the status colours **with text**), platform, destination and coaches.
  - **Short-train warning:** a train with 1–5 coaches is flagged "Short train (N coaches), may be busier". The rule is this dashboard's heuristic, so label it that way. SWR runs 3- to 12-car trains, and a 3-car Salisbury service left Waterloo on 2026-09-27.
  - The delay or cancellation reason goes under the row as plain text.
  - Replacement buses from `BusItems` go in their own group when there are any.
  - At shared stations such as Clapham Junction, show **SWR trains only** by default, with a toggle for "all operators" (`swr.allOperators`).
- **Row contract:** implement the `swr-dep-more` / `swr-dep-detail` markup and the `swr:service-open` event from [the S0 contract](#what-s0-provides-the-contract-for-s1s6). Opening a row does nothing more than that until S2 lands.
- **Refresh:** every 60 s through `refresh()`. That's 2 requests a minute.
- **Tests:** `normalizeDepartures(railinfo, huxley)` joins and flags rows: late, cancelled, short, unknown length (`0`), a missing Huxley row, and an operator filter. Base the fixtures on the Waterloo and Clapham Junction responses.

### Package S2: where is my train, calling points (item SWR-8)

**Status: ✅ done.** Notes from building it (checked on 2026-09-27 in headless Chromium at 390 px in light and dark, with S0 and S1 merged, in `?demo` and against the live APIs through `page.route` + `curl`):
- **Quirks in the real railinfo response:**
  - The top-level `Destination` is really the station the service id belongs to (the board's station).
  - That station's row has `ScheduledTime: null` when it's the origin, so its times come from the top-level `ScheduledDeparture` / `EstimatedDeparture` / `ActualDeparture`. That's also the time on S1's board, so the list uses the departure time for the viewed stop even mid-journey, where the row gives the arrival time (Surbiton: row 20:05, departure 20:09).
  - `ActualTime` is usually the words `"On time"`, not a clock time. Passed stops have `IsVisited: true` and `EstimatedTime: null`.
- **Huxley's `/service/{id}` leaves out the id's own station**, which is only in the top-level `sta`/`std`/`etd`/`atd`, so S2 inserts it between `previousCallingPoints` and `subsequentCallingPoints`. Only the first group of each list is this train; any further groups are joining or splitting portions. For the same train at the same moment, the two sources normalise to identical stops (tested).
- **Last reported location** is railinfo's `LastLocation`. Where a station appears twice (Virginia Water, on the Reading line), it's the last copy the train has passed. Without `LastLocation`, and always for Huxley, it's the last passed stop. It's labelled "last reported", not a live position.
- **Refresh:** S1 moves an open row's detail div into the new markup and re-dispatches `swr:service-open`. S2 keeps what's shown, then repaints when the (30 s cached) data arrives, keeping the open "About this data" and focus on its own controls. S1's re-render briefly takes the div out of the page, which drops focus to `<body>`; S2 restores it straight after unless focus has moved elsewhere. Late responses are dropped if the row was closed (`hidden`), removed or re-requested.
- **Folding:** passed stops before the one just before the last reported location fold behind "Show N earlier stops". The viewed and last reported stops are never folded. Whether it's open is remembered per service across refreshes.
- **Lateness colours** match S1's board: 1–4 minutes late is amber, 5 or more orange; every status also has an icon and text.
- **Demo:** the demo route asks the other demo routes (S1's fixture) for the opened row on the viewed station's railinfo board, so the demo train calls there at the row's time, with its delay, cancellation and destination. Without a row, it's an id-keyed Waterloo → Reading train.

- **Data:** `SwrApi.service(id)` (railinfo `POST /journey/services`). If that fails, fall back to `SwrApi.huxleyService(id)` (`previousCallingPoints` / `subsequentCallingPoints` with `st`, `et`, `at`, and `length` per stop).
- **Show:**
  - When `swr:service-open` fires, fill `detail.container` with a vertical list of stops: scheduled time, expected or actual time, and passed stops dimmed (`IsVisited` or `at`).
  - Mark the train's last reported location (`LastLocation`) and the station being viewed. Include "Last updated" from `GeneratedAt`.
  - Cache per service for 30 s. Refresh an open list when S1 re-dispatches the event on its refresh.
- **Tests:** `normalizeCallingPoints(railinfo)` and `normalizeHuxleyCallingPoints(huxley)` produce the same shape: order, passed or not, late minutes, and a cancelled stop.

### Package S3: SWR service status (items SWR-4, SWR-5, SWR-6)

**Status: ✅ done.** SWR-5 and SWR-6 wait for S7's `data/swr/status.json` in production; until then the section shows the TfL headline and the Huxley messages and says route status isn't available here. Notes from building it (checked on 2026-09-27 in headless Chromium at 390 px, light and dark: `?demo`, the live TfL and Huxley APIs through `page.route` + `curl`, and a served copy with a hand-made `status.json` from a fresh fetch):
- **Files:** `js/swr-status.js` (pure helpers exported for Node, a renderer, demo routes, the module), `css/swr-status.css`, `tests/swr-status.test.js`.
- **Lifecycle:** `init(ctx)` loads the TfL headline and the snapshot before a station is chosen; `onStation` adds the station's `nrccMessages`; `refresh` reloads all three (1 TfL request a minute; the snapshot and Huxley calls are cached by `SwrApi`). Late Huxley answers are dropped with `ctx.isStale()`. A failed refresh keeps the last good data, and open `<details>` stay open across refreshes.
- **Status ids:** a fresh fetch also showed `1` Minor Disruption and `3` Planned Closure. Mapped to the TfL classes as 0 good, 1 warning, 2 critical, 3 serious, 4 info; any other id by its text.
- **Route-group mapping** (`ROUTE_GROUPS`, this dashboard's own; SWR doesn't publish one). All 49 RainbowBoard descriptions map; anything new goes under "Other routes":
  - Kingston/Shepperton: Shepperton, both Kingston loops. Chessington/Epsom: Chessington South, Dorking, Guildford via Epsom.
  - Suburban Lines: Woking and Basingstoke "(Stopping)" (the least certain). Surbiton/Cobham: Guildford via Cobham, Hampton Court.
  - Hounslow Loop: both Richmond/Brentford loops. Reading/Windsor Lines: Reading, Windsor & Eton Riverside, Weybridge via Staines.
  - South Western Mainline: Weymouth, Portsmouth Harbour via Basingstoke, Alton. West of England: Salisbury/Yeovil/Exeter St Davids. Portsmouth Direct: Portsmouth via Guildford.
  - South Hampshire Locals: Southampton–Portsmouth & Southsea, Winchester–Southampton Central/Bournemouth, Lymington Branch. Romsey/Salisbury: Romsey Rounders. Ascot/Guildford: Aldershot via Ascot, Ascot–Aldershot, Guildford–Farnham. Island Line: Island Line.
- **Layout:** `#swr-status` sits above the station header, so on a phone the 13 groups pushed the station's own sections about 3000 px down. The group list is one `<details>` with a count line ("3 major disruption, 1 planned closure, 5 special timetable, 4 good service"): open before a station is chosen, folded after, and it keeps the viewer's own choice. Groups are worst first.
- **HTML:** incident `Details`/`FurtherInfo` and `nrccMessages` stay raw in the normalised data and are rendered only through `SwrApi.htmlToText` + `SwrApi.renderParagraphs` into empty slots; everything else is escaped. Times use `SwrApi.parseUkTime` (the repeated 01:30 on the October clock change reads as the GMT one).
- **Demo:** `SwrApi.demoRoutes` answers `data/swr/status.json` (real samples, times moved to just before now) and TfL's `/Line/south-western-railway/Status` (the real "Special Service" with a National Rail link). Station messages in `?demo` come from S1's Huxley route.

At the top of the SWR tab, in `#swr-status`.

- **SWR-4 headline (live):** `ctx.tfl` → `/Line/south-western-railway/Status`, shown with the existing status classes and `normalizeStatuses()`. When TfL's `reason` is only a URL (as on the day), show it as a "National Rail details" link. It's shown even before a station is chosen.
- **SWR-5 status by route group (from the snapshot):**
  - `SwrApi.snapshot('status.json')`, field `liveInformationBoard`: 13 groups (`RouteName`, `StatusText`, `StatusId`). Seen: `0` Good Service, `2` Major Disruption, `4` Special Timetable. Map any other id by its text.
  - Expanding a group shows the matching directional rows from `rainbowBoard.Lines[{Description, Status, Incidents}]` (e.g. "Portsmouth to Waterloo via Guildford", Minor Disruption, "passenger being taken ill … between Godalming and Guildford"). `Incidents` is `" "` when there's nothing.
  - Show "as of" from the snapshot's `fetchedAt`, and a "may be out of date" note when it's more than 45 minutes old.
- **SWR-6 incident details:**
  - From the snapshot's `overallstatus`: `Status` (`MajorDisruption`), `Summary`, and `LineUpdates[{Summary, Details, FurtherInfo, UpdatedTime "19:18:22 27/09/2026", IncidentId, Colour "Code Red"|"Code Yellow"}]`. `Details` is long HTML with "What's going on / What we're doing / ticket acceptance / taxis / replacement buses", so render it through `SwrApi.htmlToText` in a collapsed `<details>` per incident.
  - Live alongside it, once a station is chosen: `nrccMessages` from `SwrApi.huxleyDepartures(crs)`, the same cached request S1 makes.
- **Without the snapshot** (before S7 is merged, before the Pages switch, or from disk), show the TfL headline and the Huxley messages only.
- **Tests:** normalisers for all three snapshot parts and for `nrccMessages`, using the samples above.

### Package S4: typical busyness per morning train into Waterloo (item SWR-2)

**Status: ✅ done.** It waits for S7's `data/swr/seats/*.json` in production. Notes from building it (checked on 2026-09-28 in headless Chromium at 390 px and 1100 px, light and dark: `?demo` for WOK, SUR, GLD, WIM, WAT and BRS; a served copy with a hand-made `seats/WOK.json` built from the real Woking response; and from disk without `?demo`):
- **What the colours mean**, in SWR's words: the labels on its [How busy is my train?](https://www.southwesternrailway.com/plan-my-journey/how-busy-is-my-train) page come from its stylesheet `/Assets/css/seatAvailabilityCheckerResult.css`: `colorGreen` "Seats available", `colorAmber` "Some seats available", `colorRed` "Standing room only", **`colorVeryRed` "Full to capacity"** (a fourth level: 9 of Woking's 215 day values), and an empty value "No Service". The page says the guide shows "how busy your train is likely to be on a typical weekday morning", covers trains "Arriving before 10:00 AM", and is based on "averages of how busy your train has been between 23 April to 8 May" (that period is only in the page's HTML, not in the API).
- **Odd values:** `JourneyDuration` is a 12-hour clock time (`"12:34:00 AM"`) that doesn't even match the times (06:28 → 07:04 is 36 minutes), so the journey time comes from `Departure`/`Arrival`. `Via` is `"-"` for none. `*_TrainName` is `"Arterio"` or `""`, per day. A level SWR hasn't used before shows its own text in grey.
- **Show:** a table of trains (departs → arrives, journey time, coaches, train type) with a Mon–Fri chip per train: tinted by level, with the TfL tab's pips (1–4) and a short label ("Seats", "Some seats" (just "Some" on phones), "Standing", "Full", "No train"). Screen readers get "Tuesday: Full to capacity". A key gives SWR's full wording. Today's column is highlighted (Monday at weekends, with a note), and a Day picker changes it. On phones the table turns into one row per train with the five chips underneath.
- **Quieter picks:** Green trains first, then Amber, nearest to the "Arrive at Waterloo by" time (`swr.arriveBy`, default 09:00, `<input type="time">`), arriving at most an hour before it. If there are none, it takes the nearest ones up to an hour after it, and says so. If the last train arriving by that time is Red or VeryRed, it says so. The picks are tagged "Quieter pick" in the table. The table shows trains arriving from an hour before the time to 15 minutes after it, with "Show all N trains". Woking's 43 rows would be about 4000 px on a phone.
- **Hiding:** at Waterloo it explains that the guide covers trains *into* Waterloo. When `seats/{CRS}.json` is missing, S4 reads `seats/index.json`. If the index loads (S7 is publishing), the station just isn't covered, so the section stays hidden. If it doesn't load (opened from disk, or before S7), the section says it isn't available here. A file with no items is hidden too.
- **Refresh:** `refresh()` calls `SwrApi.snapshot()` again (cached 60 s). It re-renders only when `fetchedAt` or the day has changed, so a refresh doesn't take focus from the controls. Changing the time or day re-renders only the hint and the table. A failed refresh keeps the last good copy. The "as of" line shows `fetchedAt`, with "May be out of date" after 15 days.
- **Demo:** `SwrSeats.demoRoute` answers `data/swr/seats/{CRS}.json` for WOK, SUR, GLD, WIM, CLJ, RMD and VXH. These are synthetic, deterministic trains with the real `Items` shape, all arriving before 10:00, and fetched "last Monday 05:17 UTC". It also answers `seats/index.json` listing them, so any other station is hidden in demo too.
- **Pure helpers** (exported for tests): `seatSummary(items, day, now)`, `quieterTrains(summary, arriveBy, {limit, windowMins})`, `visibleRows`, `resolveDay` (London time, weekend → Monday), `normalizeLevel`, `normalizeSeatItem`, `durationMinutes`, `normalizeSeatFile`, `indexHasStation`, `seatsAge`, and `renderSeats`/`renderBody`, which return HTML strings so the escaping is tested in Node.

**Question:** which morning train from my station is usually least crowded?

- **Data:** `SwrApi.snapshot('seats/{CRS}.json')`, written weekly by S7. Source: `GET /api/seatavailability/{fromName}/London%20Waterloo?skip=0&take=100` → `{TotalResults, Items[{Departure, Arrival, Via, NumberOfCarriages, Monday…Friday: "Green"|"Amber"|"Red", Mon_TrainName…Fri_TrainName (e.g. "Arterio")}]}`.
- **Coverage:** weekday morning peak **into London Waterloo only**. Woking had 43 trains from 06:28 to 09:28; `London Waterloo → Surbiton` returned 0, and `seatavailability/stations/Guildford` returned `[]`.
- **What the colours mean:** take the wording from SWR's own seat availability page and quote it in the section's "About this data". Until then, show the colour names with a legend, never colour alone.
- **Show:**
  - For the chosen station: a compact table of trains with a Mon–Fri colour chip row, carriages and train type. Default to today's weekday column (Monday on weekends).
  - A "quieter trains" hint picks the Green or Amber trains nearest to a chosen arrival time (`swr.arriveBy`, default 09:00).
  - Hide the section where there's no file for the station. On Waterloo itself, say it covers trains *into* Waterloo.
- **Tests:** `seatSummary(items, day)` for sorting, the day column, the weekend fallback, and picking quieter trains near a time.

### Package S5: SWR planned closures, next 14 days (item SWR-10). Investigate first.

**No working source was found on 2026-09-27.** Start with a time-boxed investigation of about 2 hours, and write the findings into this section whether or not it works.

- **Tried:**
  - `POST https://www.southwesternrailway.com/api/overallstatus/plannedworks` with `{"StationCodes": ["5598", "5520"], "OutwardJourneyDate": "2026-10-03T10:00:00+01:00", "ReturnJourneyDate": null, "IsOpenReturn": false, "UseNlc": true, "DisplayMode": "Qtt"}` (NLC codes; the SWR website sends this before a ticket search). It returned `[]` for Waterloo–Basingstoke, Waterloo–Portsmouth Harbour and Guildford–Portsmouth Harbour on 5 dates from 28 Sep to 11 Oct.
  - TfL `/Line/south-western-railway/Status/2026-09-27/to/2026-10-11` returned only the current `Special Service`.
- **Still to try:**
  - The same POST for other station pairs, on weekends further ahead, or with `DisplayMode` variations.
  - SWR's engineering-works web pages.
  - National Rail's `service-disruptions/*` pages, which TfL's `reason` links to.
- **If a source works:** get it into the S7 snapshot (add a `closures.json` there, coordinating with whoever owns S7) and render it in `#swr-closures`, grouped by date, for the chosen station's routes.
- **If none works:** leave the section hidden, record what was tried here, and mark SWR-10 "❌ No source" in the status table.

### Package S6: station punctuality and cancellations (item SWR-11)

- **Data:** `SwrApi.snapshot('performance.json')`, written weekly by S7. Source: `GET /api/stationperformance/{name}?skip=0&take=10` → `{Items[{StationName, CRSCode, Punctal: "85.00", Cancelled: "3.90"}, {StationName: "Wessex route target", Punctal: "86.12", Cancelled: "3.68"}], Period: "4-Week Period from 26 July to 22 August", Next3MonthPlan, NextYearPlan, LongTermPlan}`. There are 171 station names from `/api/stationperformance/GetStations`.
- **Show:** two stat tiles, "On time %" and "Cancelled %", each compared with the route target (better or worse, in words), plus the period. The three "plan" texts go in a collapsed `<details>`. Label it clearly as a past 4-week period, not live.
- **Tests:** `performanceSummary(raw)` for parsing the strings to numbers, picking the target row, better or worse than target, and missing values.

### Package S7: scheduled snapshots of the SWR website API

The SWR website API sends no CORS headers, so the site publishes copies of it from GitHub Actions.

- **Script:** `scripts/swr-snapshot.js` (Node LTS, global `fetch`, no dependencies, CommonJS like the rest).
  - **Be polite:** one request at a time, at least 1 s apart, a 30 s timeout, one retry, and `User-Agent: tfl-dashboard (https://github.com/jinalharia/tfl-dashboard)`.
  - `--status --out <dir>` writes `status.json`: 3 requests, run on every deploy and every 15 minutes.
  - `--weekly --out data/swr` writes `seats/*.json`, `seats/index.json` and `performance.json`: about 350 requests, around 6 minutes at 1 per second.
  - A failed source is recorded in `errors` and never fails the run.
- **Station names:** seat availability and performance use their **own names** (`"Ascot"` and `"Boxhill & Westhumble"` versus swrstations' `"Ascot (Berks)"` and `"Box Hill and Westhumble"`, and the seat list includes a `"NOT FOUND"` entry). Map them to CRS with a pure, tested `matchStationName(name, SWR_STATIONS)`: normalise `&`/`and` and brackets, and add a small alias table for the rest. List any names that still don't match in the PR.
- **Workflows:**
  - `pages.yml`: add `schedule: cron '7,22,37,52 * * * *'`, and allow `schedule` in the deploy job's `if`. The *Stage site files* step copies `data/` too and runs `node scripts/swr-snapshot.js --status --out _site/data/swr`.
  - New `swr-weekly.yml`: runs Mondays around 05:17 UTC and on `workflow_dispatch`, with `contents: write` and `actions: write`. It runs `--weekly`, commits `data/swr/` to `main` only if something changed, then starts `pages.yml` with `gh workflow run`, because a push made with `GITHUB_TOKEN` doesn't trigger workflows.
  - Scheduled runs can start 10–30 minutes late, and GitHub turns schedules off after 60 days with no repo activity. The page shows `fetchedAt` so staleness is visible.
- **Depends on the owner's Pages switch** (package D). Until the Pages source is *GitHub Actions*, `status.json` isn't published, but the committed weekly files are served from `main` anyway. S3, S4 and S6 must handle both cases.
- **Tests:** `matchStationName`, and a function that builds each file from raw responses. Fixtures are the samples in S4 and S6 and an `overallstatus` / `LiveInformationBoard` / `RainbowBoard` trio.

#### Snapshot file formats (S7 writes, S3, S4, S6 read)

```
data/swr/status.json        { fetchedAt, errors: {name: message},
                              overallstatus: <raw /api/overallstatus>,
                              liveInformationBoard: <raw /api/LiveInformationBoard>,
                              rainbowBoard: <raw /api/RainbowBoard> }
data/swr/seats/index.json   { fetchedAt, stations: [{crs, seatName}] }
data/swr/seats/{CRS}.json   { fetchedAt, crs, from: <seatName>, to: "London Waterloo", items: <raw Items[]> }
data/swr/performance.json   { fetchedAt, period, target: {punctual, cancelled},
                              stations: {CRS: <raw /api/stationperformance/{name} response>} }
```

Raw responses are kept as they come, so the normalisers in S3, S4 and S6 can be tested against the same shapes the live API returns.

### Conventions for the SWR packages (on top of the ones below)

- **Names:** files `js/swr-*.js`, `css/swr-*.css`, `tests/swr-*.test.js`; element ids and classes start with `swr-`; `localStorage` keys start with `swr.`.
- **Honesty:** each section ends with its own collapsed "About this data" that names the source. Say when it's unofficial (the SWR website API, Huxley2), a snapshot (with its time) or this dashboard's heuristic (the short-train warning). Put these in the section, not in the TfL "About the data" card, so packages don't conflict.
- **Security:** everything from SWR, Huxley2 and National Rail is untrusted, and several fields are HTML. Use `SwrApi.htmlToText`, `esc()` or `textContent`.
- **Checking against live data in a Claude Code cloud session:**
  - The environment's network settings must allow `railinfo.southwesternrailway.com`, `huxley2.azurewebsites.net` and `www.southwesternrailway.com`, as well as `api.tfl.gov.uk`.
  - Use the same Playwright `page.route` and `curl` approach as for TfL, for each host.
- **README:** add an "SWR and National Rail endpoints" table next to the TfL one, one row per endpoint a package uses.

## Conventions for every package

- **Code layout:**
  - `js/tfl-api.js`: API calls and **pure, unit-tested** normalisation helpers, exported for Node.
  - `js/app.js`: loading and rendering.
  - `js/chart.js`: SVG charts.
  - `js/demo-data.js`: fake responses for `?demo`.
  - Classic scripts, no modules and no build step, so opening `index.html` from disk keeps working.
- **Demo mode:** every new endpoint needs a matching route in `js/demo-data.js` that returns the real response shape, so `?demo` keeps working with no network.
- **Tests:** `npm test` (node:test). Base test fixtures on the **real** response shapes, and put a comment on each saying which endpoint it came from.
- **Security:** API strings are untrusted. Escape them (`esc()`) or use `textContent`, never raw `innerHTML`.
- **Honesty in the page:** label estimates and unlabelled TfL figures as such, both in the UI and in the "About the data" section of `index.html`. Keep `README.md`'s endpoint table up to date.
- **Design:** follow the existing tokens in `css/styles.css` (light and dark). Crowding levels use the status colours plus pips plus a text label, never colour alone. Check at 390 px width with no horizontal scroll.
- **Checking against the live API in a Claude Code cloud session:**
  - The environment's network settings must allow `api.tfl.gov.uk`.
  - Headless Chromium doesn't trust this environment's proxy certificate. Don't switch off certificate checks. Instead, open `index.html` from disk and, in Playwright, `page.route('https://api.tfl.gov.uk/**', …)` to fetch each request with `curl` (which verifies certificates) and pass the body back to the page.
  - Real browsers call the API directly; TfL sends `Access-Control-Allow-Origin: *`.
- **Git:** one branch and PR per package, each with a clear title. Update this file's status table in the same PR when you finish an item.
