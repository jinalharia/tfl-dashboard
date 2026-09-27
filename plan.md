# Dashboard additions: plan and hand-off

Status of additions to the live station crowding dashboard, written so separate agents can each take a work package. Last updated 2026-09-27.

Live site: https://jinalharia.github.io/tfl-dashboard/. GitHub Pages deploys `main` from the repo root, about a minute after each merge.

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
| 2 | Live crowding along a whole line | ⬜ To do | C |
| — | Deploy only when tests pass (GitHub Actions) | ⬜ Optional | D |
| — | Boarding estimate: trains you may need to let go before boarding | ✅ Done (package E) | E |

**Note on #1.** The proposal was "entry/exit footfall", but TfL's `passengerFlows` are about 10 *unlabelled* values per 15-minute slice, so they can't be split into entries and exits. What shipped is **typical passenger flow per line**: the per-slice sum, charted on each line card. TfL gives one profile for all days and it follows a weekday pattern, so the card says so at weekends.

**Out of scope** (considered and rejected: they don't help someone deciding whether a station is too busy): air quality, road disruptions, car parks, accident stats.

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

- **Route:** `GET /Line/{id}/Route/Sequence/{outbound|inbound}` → `{stations[], orderedLineRoutes[{name, naptanIds[]}], stopPointSequences, ...}`. The Victoria line outbound had 1 ordered route of 16 NaPTANs (`940GZZLUBXN` → …). Branching lines such as the Northern and District have several `orderedLineRoutes`, so pick the longest, or let the user choose a branch.
- **Crowding:** `GET /crowding/{naptan}/Live` per station, which is **one request per station** (16 for Victoria, 60+ for the District line). TfL's anonymous rate limit is low, so:
  - load it only on demand (a "Show whole line" button on a line card)
  - send the requests a few at a time, not all at once
  - cache the results for about 60 s
  - show a hint to add an app key if a 429 comes back.
- **Show:** a strip or ladder of stations along the line, each coloured and labelled by crowding level (use `crowdingLevel()` for the label and the status colours), with the selected station highlighted. Stations with no data (DLR, Network Rail-run stations) should show as "no data", not zero.
- **Tests:** a pure helper that turns a route sequence into an ordered station list, with unit tests.

### Package D (optional): tested deploys

Add `.github/workflows/pages.yml`: on push to `main`, run `npm test`, then `actions/upload-pages-artifact` and `actions/deploy-pages`. The repo owner then has to switch **Settings → Pages → Source** to *GitHub Actions*. Coordinate that with the owner before merging, or the site will stop updating.

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
