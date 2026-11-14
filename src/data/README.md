# Sample data

Everything in this folder is **SIMULATED**, with two exceptions described below: the community counts from the corridor analysis, and the `real/` subfolder. The Port of Long Beach is at its real location; the warehouses, shipments, travel times and the incident are fictional. Routes are illustrative and not verified for trucks.

## Where it comes from

The JSON files are generated from the team's ArcGIS feature service, which is the source of truth for geography and shipments:

`https://services.arcgis.com/QPnoxtBFXm6yYtyc/arcgis/rest/services/PortPlan_%E2%80%94_Disruption_Triage_WFL1/FeatureServer`

Do not edit the JSON files by hand. Change the feature service, then run:

```bash
python3 scripts/import_map_data.py
```

The script rebuilds every file here except the values in `assumptions.json`, pre-calculates the sample responses, and compares its results with the service's own rows for all three scenarios. It exits with an error if anything disagrees. `python3 scripts/import_map_data.py --check` verifies without writing.

Import from `index.ts`, never from the JSON files directly.

## Files

| File | Contents |
| --- | --- |
| `facilities.json` | The port and three warehouses, with coordinates |
| `segments.json` | Nine road segments with geometry (GeoJSON LineString, lon/lat), miles and min/max minutes |
| `routes.json` | One original and one alternative route per warehouse, as ordered segment ids, with stored totals |
| `shipments.json` | Ten shipments: readiness, appointment window and assigned route |
| `assumptions.json` | Cost, fuel economy and emission factor placeholders, each with a source |
| `corridor.json` | The corridor analysis: REAL schools and disadvantaged tracts within 150 m of each ILLUSTRATIVE route, with sources and dates. Written by `scripts/corridor_analysis.py` |
| `corridor-layers.json` | The places counted in `corridor.json` (school points, tract outlines), for the map only |
| `sample-responses.json` | For both scenarios: a summary per shipment, normal baselines, and Wait / Reroute / Request later slot for affected shipments. Replaced by engine output in E3 and E4 |

Each file has a top-level `label` of `SIMULATED`. List files wrap their records as `{ "label", "source", "items" }`.

## Geometry and miles

Segment lines are schematic: a few points along the real corridor, enough to draw the route. The `miles` values are the stated illustrative distances from the feature service and are longer than the drawn lines. Calculations use the stated miles.

## Calculation rules

The same rules the engine implements in E1 to E3.

- **Departure** = max(cargo_ready, truck_available) + pickup_handling_min (30 min).
- **Arrival range:** walk the route's segments with `minutes_min` and with `minutes_max`.
- **Closure:** a truck that reaches the closed segment at or after the start and before it reopens waits until reopening, then continues. A truck arriving after reopening is unaffected.
- **Appointment:** service must start by `appt_end`; arriving exactly at `appt_end` is on time; early arrivals wait until `appt_start`.
- **Lateness** = max(0, max(arrival, appt_start) - appt_end), for the min and max arrival.
- **Risk:** ON_TRACK when the max arrival meets the deadline; TIGHT when only the min does; LATE when neither does; UNKNOWN when information is missing.
- **Driver duty** = departure to arrival in the max-arrival case, including waiting at the closure.
- **Cost** = miles x $1.80 + duty hours x $40, rounded to whole dollars (max-arrival case).
- **Tailpipe CO2** = miles / 6.5 mpg x 10.21 kg per gallon, rounded to one decimal.
- **Reroute** uses the destination's alternative route and is unavailable if that route also uses the closed segment.
- **Request later slot** is pending: no metrics, and its risk stays the shipment's current risk.

The team plan's reference table ($121 normal, $161 wait, $158 reroute) is the min-arrival case of shipment S-01. This data stores the max-arrival case, as the feature service does: $130, $169 and $167.

## Sample incident

`NB-03` closed from 10:00, reported reopening 11:10 (an estimate, not a guarantee).

## Facilities

| Id | Name | Type | Lat, lon |
| --- | --- | --- | --- |
| `PORT-LB` | Port of Long Beach | port | 33.754, -118.216 |
| `WH-A` | Summit Ridge Distribution (fictional) | warehouse | 34.04, -117.85 |
| `WH-B` | Valley Crossing Logistics (fictional) | warehouse | 34.075, -118.02 |
| `WH-C` | Bayline Fulfillment (fictional) | warehouse | 33.84, -118.26 |

## Segments

| Id | Name | Miles | Minutes | Schools within 150 m | Disadvantaged tracts within 150 m |
| --- | --- | --- | --- | --- | --- |
| `PORT-01` | Port exit to I-710 (Ocean Blvd / I-710 ramps) | 5 | 10 to 12 | 0 | 7 |
| `NB-03` | I-710 northbound to SR-60 east (shared corridor) | 25 | 30 to 38 | 5 | 39 |
| `WH-A-APPR` | SR-60 east to WH-A | 15 | 20 to 24 | 2 | 10 |
| `EB-405` | I-405 east / I-605 north to SR-60 (alternative corridor) | 40 | 45 to 52 | 7 | 17 |
| `WH-B-APPR` | I-605 north to WH-B | 10 | 15 to 18 | 0 | 8 |
| `HARBOR-110` | I-110 Harbor Fwy northbound (alternative corridor) | 24 | 35 to 45 | 12 | 53 |
| `XTOWN-B` | I-10 east to WH-B | 21 | 30 to 38 | 6 | 27 |
| `WEST-405` | I-405 west to WH-C | 11 | 18 to 23 | 0 | 10 |
| `C-LOCAL` | Alameda St / local streets to WH-C | 12 | 32 to 38 | 0 | 9 |

The counts are real places beside a schematic line; see Corridor analysis below. The feature service's two hand-drawn SYNTHETIC zones are no longer used.

## Routes

| Id | To | Kind | Segments | Miles | Minutes | Schools | Tracts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `R-A-ORIG` | WH-A | original | PORT-01, NB-03, WH-A-APPR | 45 | 60 to 74 | 7 | 53 |
| `R-A-ALT` | WH-A | alternative | PORT-01, EB-405, WH-A-APPR | 60 | 75 to 88 | 9 | 31 |
| `R-B-ORIG` | WH-B | original | PORT-01, NB-03, WH-B-APPR | 40 | 55 to 68 | 5 | 51 |
| `R-B-ALT` | WH-B | alternative | HARBOR-110, XTOWN-B | 45 | 65 to 83 | 18 | 79 |
| `R-C-ORIG` | WH-C | original | PORT-01, WEST-405 | 16 | 28 to 35 | 0 | 15 |
| `R-C-ALT` | WH-C | alternative | C-LOCAL | 12 | 32 to 38 | 0 | 9 |

Schools and tracts are counted once per route, within 150 m (real locations, illustrative route).

## Shipments and expected results

| Shipment | To | Appointment | Departs | Normal | After the closure (wait) | Reroute | Category |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 (reference) | WH-A | 11:00-11:30 | 10:00 | 11:00 to 11:14 ON_TRACK | 12:00 to 12:12 LATE, 30 to 42 min late | 11:15 to 11:28 ON_TRACK, $167 | LATE; fixed by rerouting |
| S-02 | WH-A | 13:00-14:00 | 10:15 | 11:15 to 11:29 ON_TRACK | 12:00 to 12:12 ON_TRACK | 11:30 to 11:43 ON_TRACK, $167 | Affected but ON_TRACK |
| S-03 | WH-A | 11:00-11:34 | 10:20 | 11:20 to 11:34 ON_TRACK | 12:00 to 12:12 LATE, 26 to 38 min late | 11:35 to 11:48 LATE, $167 | LATE; no confirmed response fixes it |
| S-04 | WH-B | 11:00-11:20 | 10:10 | 11:05 to 11:18 ON_TRACK | 11:55 to 12:06 LATE, 35 to 46 min late | 11:15 to 11:33 TIGHT, $136 | LATE; rerouting may still be late |
| S-05 | WH-B | 13:30-14:30 | 10:40 | 11:35 to 11:48 ON_TRACK | 11:55 to 12:06 ON_TRACK | 11:45 to 12:03 ON_TRACK, $136 | Affected but ON_TRACK |
| S-06 | WH-A | 12:30-13:30 | 11:30 | 12:30 to 12:44 ON_TRACK | 12:30 to 12:44 ON_TRACK | none | Unaffected |
| S-07 | WH-B | 11:30-12:00 | 10:00 | 10:55 to 11:08 ON_TRACK | 11:55 to 12:06 TIGHT, 0 to 6 min late | 11:05 to 11:23 ON_TRACK, $136 | TIGHT; fixed by rerouting |
| S-08 | WH-C | 09:30-10:30 | 09:00 | 09:28 to 09:35 ON_TRACK | 09:28 to 09:35 ON_TRACK | none | Unaffected |
| S-09 | WH-C | 11:00-12:00 | 10:45 | 11:13 to 11:20 ON_TRACK | 11:13 to 11:20 ON_TRACK | none | Unaffected |
| S-10 | WH-C | 13:00-14:00 | 12:30 | 12:58 to 13:05 ON_TRACK | 12:58 to 13:05 ON_TRACK | none | Unaffected |

The mix covers: unaffected shipments, affected shipments that stay on track, tight and late shipments, shipments that rerouting fixes, and one (S-03) that no confirmed response fixes.

## Corridor analysis (150 m)

`scripts/corridor_analysis.py` counts the real schools and SB 535 disadvantaged community tracts within 150 m of each route's drawn line, and writes the result to `corridor.json`, `corridor-layers.json`, `routes.json`, `segments.json` and the sample responses.

```bash
python3 scripts/corridor_analysis.py           # analyse and write
python3 scripts/corridor_analysis.py --check   # analyse and report only
```

Run it after `import_map_data.py` and again whenever a segment line changes. `import_map_data.py` copies the stored counts in on every run; if the lines no longer match the stored analysis it leaves the counts out and says so.

| Layer | Publisher | Edition | Downloaded |
| --- | --- | --- | --- |
| Public School Locations, Current | National Center for Education Statistics | 2024-2025 | 2026-11-14 |
| SB 535 Disadvantaged Communities 2022 | California Office of Environmental Health Hazard Assessment (CalEPA) | 2022 | 2026-11-14 |

- **What 150 m means.** It is a proximity measure, not measured exposure and not a health impact. The distance follows Kozawa, Fruin and Winer (2009), who measured raised diesel pollutants within about 150 m downwind of freeways next to the Ports of Los Angeles and Long Beach.
- **How it is measured.** A school counts when it lies within 150 m of the line; a tract counts when any part of it does. Distances are in metres in California Albers (EPSG:3310). A route's count is the set of places near any of its segments, so a school beside two segments is counted once.
- **The lines are schematic.** They are a few points along each corridor, not the road itself. Measured against Caltrans highway lines on 2026-11-14, the drawn segments sit a median of about 150 m to 1,900 m from the real highway, and only 0% to 50% of each segment is within 150 m of it. The counts are therefore real places near a drawn line, and will change when the lines are redrawn along the roads. Rerun the script after that.
- **The trade-off in the data.** For Warehouse B the alternative passes more of both: 18 schools and 79 tracts against 5 and 51. No alternative passes fewer schools and fewer tracts than its original over more miles, which the GIS brief also asks for. The brief's answer to that is to change which route is used, never the data.
- **Diesel percentile.** `max_diesel_pm_pctl` is the highest CalEnviroScreen 4.0 diesel particulate percentile among the tracts a route passes. It is 99.8 for every route, so it does not tell the routes apart and the dashboard does not show it.

## Real reference data (`real/`)

The two files in `real/` are labelled **REAL**. They come from public Caltrans sources and are matched to the simulated segments above. They are reference only: the app does not calculate with them, they are a snapshot and not a live feed, and nothing in them says a route is legal or suitable for trucks.

Rebuild them after `import_map_data.py` with:

```bash
python3 scripts/import_reference_data.py
```

`python3 scripts/import_reference_data.py --check` fetches and reports without writing. Import from `real/index.ts`, never from the JSON files directly.

| File | Contents | Source |
| --- | --- | --- |
| `real/lane-closures.json` | Planned and current lane closures on the highways the segments follow: lanes closed, planned start and end, actual start and end where recorded | Caltrans Lane Closure System, District 7 |
| `real/truck-network.json` | The truck designation Caltrans records for the state highways each segment follows, and where it has no record | Caltrans Truck Network layer |

Things to know before using them:

- **Matching is approximate.** Segment lines are schematic, so a closure or highway stretch is matched by highway number and direction first, then by distance (3 km for closures, 2.5 km for the truck network). Which highway each segment follows is a table at the top of the script, read from the segment names; the import stops if a segment has no entry.
- **Closures are mostly planned roadwork**, about nine days around the import date. They are not a record of crashes or emergency closures.
- **Ramp closures are left out**, because the illustrative routes do not say which ramps they use. The file records how many were left out.
- **Each run merges with the last.** Closures seen before are kept and updated, so running the import on later days builds up actual end times. Two runs do not give the same file.
- **The truck network has gaps.** It has no rows for SR-60, and it does not cover surface streets (`C-LOCAL`). A missing record does not mean trucks are barred. Times in the closures file are Pacific local time.
- **Used by the dashboard.** The truck network file feeds the "Truck network (Caltrans record)" row of the response comparison (G5). It reports what Caltrans records and where it has no record; it never says a truck may or may not use a route. Set `VITE_TRUCK_NETWORK_CHECK=off` to hide the row. The lane closures file is not used by the dashboard.
