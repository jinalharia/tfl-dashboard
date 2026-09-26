# tfl-dashboard

A static HTML dashboard showing **live crowding for every line at a London station**, built on the [TfL Unified API](https://api.tfl.gov.uk/swagger/ui/index.html) and the TfL Crowding API.

Search for a station (or pick a popular one) and the dashboard shows:

- **Live busyness per station entrance group.** TfL publishes crowding per station NaPTAN, and interchanges have one per network. At Stratford, for example, the Underground (Central, Jubilee), the Elizabeth line and Overground, and the DLR each get their own live reading, compared with what's usual for this time of day.
- **Today: typical vs live.** Today's typical 15-minute busyness profile for each group, with a "now" line and the live reading marked on it. Hover (or focus and use the arrow keys) to read values. There's also a data table view.
- **A card for each line** with:
  - line status and disruption details
  - the live station busyness for the entrances that line uses, with a tick for what's usual now
  - a *platform outlook* estimate (see below)
  - typical train loading per direction, where TfL publishes it
  - the next trains on each platform

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
| Typical train loading per line | `GET /StopPoint/{naptan}/Crowding/{line}?direction=all` |

**Coverage:** TfL doesn't publish crowding for every station. When checked, it was available for Underground stations and some Elizabeth line stations such as Bond Street (`910GBONDST`), but not for Stratford's DLR or rail entrances (`940GZZDLSTD`, `910GSTFD`) or Liverpool Street rail (`910GLIVST`). When the API reports `isFound: false` and no live reading, the dashboard says there's no data rather than showing a blank.

Crowding bands used for the labels: Quiet < 25%, Moderately busy 25–50%, Busy 50–75%, Very busy ≥ 75% of baseline.

**Platform outlook** is this dashboard's own heuristic, not a TfL figure. It starts from the station's live level and raises it for disruption on that line (a full step for severe disruption, part of a step for minor delays) and a little when the next train is 8 or more minutes away.

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
