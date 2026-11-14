# Sample data

Everything in this folder is **SIMULATED**. The Port of Long Beach is at its real location; the warehouses, shipments, travel times and the incident are fictional. Routes are illustrative and not verified for trucks.

## Where it comes from

The JSON files are generated from the team's ArcGIS feature service, which is the source of truth for geography and shipments:

`https://services.arcgis.com/QPnoxtBFXm6yYtyc/arcgis/rest/services/PortPlan_%E2%80%94_Disruption_Triage_WFL1/FeatureServer`

Do not edit the JSON files by hand. Change the feature service, then run:

```bash
python3 scripts/import_map_data.py
```

The script rebuilds the generated JSON files except the values in `assumptions.json`, pre-calculates the test-fixture responses, and compares its results with the service's own rows for all three scenarios. It exits with an error if anything disagrees. `python3 scripts/import_map_data.py --check` verifies without writing. It does not generate `demoIncident.ts`.

Application code imports from `index.ts`, never from the JSON files directly.
Its summary, baseline and response helpers calculate fresh engine estimates from
the raw inputs; stored route totals are not calculation inputs. The Node evaluation
CLI reads raw JSON via `fs` and imports the pure engine, without a Vite loader.

## Files

| File | Contents |
| --- | --- |
| `facilities.json` | The port and three warehouses, with coordinates |
| `segments.json` | Nine road segments with geometry (GeoJSON LineString, lon/lat), miles and min/max minutes |
| `routes.json` | One original and one alternative route per warehouse, as ordered segment ids, with stored totals |
| `shipments.json` | Ten shipments: readiness, appointment window and assigned route |
| `assumptions.json` | Cost, fuel economy and emission factor placeholders, each with a source |
| `sample-responses.json` | Generated regression test fixture only: summaries, baselines and options. Never imported by the app or evaluation exporter |
| `demoIncident.ts` | Independent typed SIMULATED NB-03 incident input; not generated |

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
This fixed demo input lives in `demoIncident.ts`, independently of the generated
response fixture. `npm run evaluate` regenerates the nine-row estimated SIMULATED
comparison in `docs/evaluation.csv` and `.json`; see the root README for its
evaluation-only selection rule and export metadata.

## Facilities

| Id | Name | Type | Lat, lon |
| --- | --- | --- | --- |
| `PORT-LB` | Port of Long Beach | port | 33.754, -118.216 |
| `WH-A` | Summit Ridge Distribution (fictional) | warehouse | 34.04, -117.85 |
| `WH-B` | Valley Crossing Logistics (fictional) | warehouse | 34.075, -118.02 |
| `WH-C` | Bayline Fulfillment (fictional) | warehouse | 33.84, -118.26 |

## Segments

| Id | Name | Miles | Minutes | Near a flagged zone |
| --- | --- | --- | --- | --- |
| `PORT-01` | Port exit to I-710 (Ocean Blvd / I-710 ramps) | 5 | 10 to 12 | no |
| `NB-03` | I-710 northbound to SR-60 east (shared corridor) | 25 | 30 to 38 | no |
| `WH-A-APPR` | SR-60 east to WH-A | 15 | 20 to 24 | no |
| `EB-405` | I-405 east / I-605 north to SR-60 (alternative corridor) | 40 | 45 to 52 | yes: Passes SYNTHETIC school zone (Z-01) |
| `WH-B-APPR` | I-605 north to WH-B | 10 | 15 to 18 | no |
| `HARBOR-110` | I-110 Harbor Fwy northbound (alternative corridor) | 24 | 35 to 45 | yes: Passes SYNTHETIC residential area (Z-02) |
| `XTOWN-B` | I-10 east to WH-B | 21 | 30 to 38 | no |
| `WEST-405` | I-405 west to WH-C | 11 | 18 to 23 | no |
| `C-LOCAL` | Alameda St / local streets to WH-C | 12 | 32 to 38 | no |

The flagged zones are two hand-drawn SYNTHETIC rectangles in the feature service. Real school and community layers arrive with the corridor analysis (G3).

## Routes

| Id | To | Kind | Segments | Miles | Minutes |
| --- | --- | --- | --- | --- | --- |
| `R-A-ORIG` | WH-A | original | PORT-01, NB-03, WH-A-APPR | 45 | 60 to 74 |
| `R-A-ALT` | WH-A | alternative | PORT-01, EB-405, WH-A-APPR | 60 | 75 to 88 |
| `R-B-ORIG` | WH-B | original | PORT-01, NB-03, WH-B-APPR | 40 | 55 to 68 |
| `R-B-ALT` | WH-B | alternative | HARBOR-110, XTOWN-B | 45 | 65 to 83 |
| `R-C-ORIG` | WH-C | original | PORT-01, WEST-405 | 16 | 28 to 35 |
| `R-C-ALT` | WH-C | alternative | C-LOCAL | 12 | 32 to 38 |

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
