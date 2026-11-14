# Sample data (SIMULATED)

Hand-written synthetic fixtures for issue #3 (D2). Every file is labelled
`"label": "SIMULATED"`. No real operations data, no driver names, no personal
data. Segment `geometry` is null until G1; sensitive-zone counts are null until G3.
Port coordinates are the approximate real location of the Port of Long Beach;
warehouse names are fictional and their coordinates are only plausible.

Import through `index.ts`, not the JSON files.

## Files and shapes

| File | Shape |
| --- | --- |
| `facilities.json` | `{ label, items: Facility[] }`: `PORT-LB`, `WH-A`, `WH-B`, `WH-C` |
| `segments.json` | `{ label, items: RoadSegment[] }`: 8 segments |
| `routes.json` | `{ label, items: RouteRecord[] }`: `Route` plus `sensitive_zone_note`, `total_miles`, `total_minutes_min`, `total_minutes_max` (sums of segments) |
| `shipments.json` | `{ label, items: Shipment[] }`: 10 shipments |
| `assumptions.json` | `{ label, placeholder: true, ...Assumptions, placeholders: { field: true } }` |
| `sample-responses.json` | `{ label, note, reference_shipment_id, incident: Incident, baselines: { [shipmentId]: Baseline }, scenarios: { normal \| disrupted: { [shipmentId]: { summary: ShipmentSummary, options: ResponseOption[] } } } }` |

`ShipmentSummary` and `Baseline` are defined in `src/viewModels.ts`. Options are
stored only for affected shipments in the `disrupted` scenario, in the order
wait, reroute, request_slot; every other entry has `options: []`.

## Segments and routes

| Segment | Miles | Minutes min-max |
| --- | --- | --- |
| PORT-01 | 5 | 10 |
| NB-03 | 25 | 30 |
| WH-A-APPR | 15 | 20 |
| EW-07 | 40 | 45 (near sensitive zone, PLACEHOLDER) |
| WH-B-APPR | 8 | 15-25 |
| HBR-02 | 12 | 20-30 |
| WH-C-APPR | 20 | 25-35 |
| LNK-06 | 6 | 10-15 |

| Route | Segments | Miles | Minutes | Uses NB-03 |
| --- | --- | --- | --- | --- |
| R-A-ORIG | PORT-01, NB-03, WH-A-APPR | 45 | 60 | yes |
| R-A-ALT | PORT-01, EW-07, WH-A-APPR | 60 | 75 | no (near_sensitive_zone: true) |
| R-B-ORIG | PORT-01, NB-03, WH-B-APPR | 38 | 55-65 | yes |
| R-B-ALT | PORT-01, LNK-06, NB-03, WH-B-APPR | 44 | 65-80 | yes |
| R-C-ORIG | PORT-01, HBR-02, WH-C-APPR | 37 | 55-75 | no |
| R-C-ALT | PORT-01, NB-03, LNK-06, WH-C-APPR | 56 | 75-90 | yes |

NB-03 is used by 4 of the 6 routes. WH-C shipments (2) travel a route that avoids it.

## Hand-calculation rules

Assumptions (all placeholders): pickup handling 30 min, $1.80/mile non-labor,
$40/hour labor, 6.5 mpg, 10.21 kg CO2 per gallon of diesel.

1. Departure = max(cargo_ready, truck_available) + pickup_handling_min.
2. Walk the route's segments in order, once with `minutes_min` (arrival_min) and once with `minutes_max` (arrival_max).
3. Closure: a truck entering the closed segment at or after the closure start and before the reopening waits until the reopening, then continues. A truck entering at or after the reopening is unaffected. Sample incident: NB-03 closed from 10:00, reported reopening 11:10. The fixtures avoid the edge cases of a truck already on NB-03 at 10:00 and of entering exactly at 11:10.
4. Appointment: service must start by appt_end; arriving exactly at appt_end is on time; an early arrival waits until appt_start.
5. Lateness = max(0, max(arrival, appt_start) - appt_end), for min and max arrival.
6. Risk: ON_TRACK if arrival_max meets appt_end; TIGHT if only arrival_min does; LATE if neither; UNKNOWN when information is missing.
7. Driver duty = departure to arrival_max, including closure waiting (not the wait for appt_start).
8. Cost = miles x 1.80 + (duty / 60) x 40, rounded to whole dollars. CO2 kg = miles / 6.5 x 10.21, rounded to 1 decimal.
9. Reroute uses the destination's alternative route; if it also uses the closed segment, it is unavailable (risk UNKNOWN, numeric fields null, status explains why).
10. Request later slot: status "Pending confirmation; original deadline still applies", `requires_confirmation: true`, numeric fields null, risk equal to the shipment's current disrupted risk (never improves it).
11. `affected` is true when the closure adds waiting to the assigned route. In the disrupted scenario the summary is the current plan (stay on the assigned route and wait).

## Expected labels per shipment

Times are departure / arrival (min-max). Normal baseline: WH-A 45 mi, $121, 70.7 kg, 60 min duty; WH-B 38 mi, $112, 59.7 kg, 65 min; WH-C 37 mi, $117, 58.1 kg, 75 min.

| Shipment | Dest | Appt | Dep | Normal | Disrupted (wait) | Reroute | Mix category |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SHP-001 (reference) | WH-A | 11:00-11:30 | 10:00 | 11:00 ON_TRACK | 12:00 LATE, 30 late, $161 | 11:15 ON_TRACK, 60 mi, $158, 94.2 kg | Affected, LATE; fixed by rerouting |
| SHP-002 | WH-A | 09:30-10:30 | 09:00 | 10:00 ON_TRACK | 10:00 ON_TRACK | none | Unaffected (clears NB-03 by 09:40) |
| SHP-003 | WH-A | 11:30-12:30 | 10:30 | 11:30 ON_TRACK | 12:00 ON_TRACK, $141 | 11:45 ON_TRACK, $158 | Affected but ON_TRACK |
| SHP-004 | WH-A | 10:45-11:15 | 10:15 | 11:15 ON_TRACK (exactly at appt_end) | 12:00 LATE, 45 late, $151 | 11:30 LATE, 15 late, $158 | Affected, LATE; no confirmed response fixes |
| SHP-005 | WH-A | 12:00-13:00 | 11:30 | 12:30 ON_TRACK | 12:30 ON_TRACK | none | Unaffected (reaches NB-03 at 11:40, after reopening) |
| SHP-006 | WH-B | 11:00-12:15 | 10:00 | 10:55-11:05 ON_TRACK | 11:55-12:05 ON_TRACK, $152 | unavailable (UNKNOWN) | Affected but ON_TRACK |
| SHP-007 | WH-B | 11:30-12:00 | 10:45 | 11:40-11:50 ON_TRACK | 11:55-12:05 TIGHT, 0-5 late, $122 | unavailable (UNKNOWN) | Affected, TIGHT |
| SHP-008 | WH-B | 10:30-11:15 | 10:10 | 11:05-11:15 ON_TRACK | 11:55-12:05 LATE, 40-50 late, $145 | unavailable (UNKNOWN) | Affected, LATE; no confirmed response fixes |
| SHP-009 | WH-C | 09:30-10:00 | 09:00 | 09:55-10:15 TIGHT | 09:55-10:15 TIGHT | none | Unaffected (route avoids NB-03), TIGHT |
| SHP-010 | WH-C | 11:00-12:00 | 10:30 | 11:25-11:45 ON_TRACK | 11:25-11:45 ON_TRACK | none | Unaffected (route avoids NB-03) |

Request later slot (all affected shipments): pending, risk equal to the Disrupted column.

Mix: unaffected 4 (002, 005, 009, 010); affected but ON_TRACK 2 (003, 006);
TIGHT or LATE after closure 5 (001, 004, 007, 008, 009); fixed by rerouting 1 (001);
no confirmed response fixes 2 (004, 008). The reroute always costs more miles and CO2.
