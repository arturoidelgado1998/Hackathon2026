#!/usr/bin/env python3
"""Import the team's ArcGIS feature service into src/data.

The feature service is the source of truth for geography and shipments:
facilities, road segments (with geometry) and each shipment's route,
appointment and normal arrival. This script reads it, rebuilds the JSON
files the app loads, and pre-calculates the sample responses with the
team plan's rules (the same rules the engine will implement in E1 to E3).

It then checks its results against the service's own rows for all three
scenarios (arrival, lateness, risk and miles) and exits non-zero if anything
disagrees. The service's cost and CO2 columns were calculated with earlier
placeholder rates and are not compared.

Usage (Python 3.9+, standard library only):

    python3 scripts/import_map_data.py           # fetch, write src/data, verify
    python3 scripts/import_map_data.py --check   # fetch and verify only

All values are SIMULATED. Routes are illustrative and not verified for trucks.

The one exception is the community counts. When src/data/corridor.json exists
(written by scripts/corridor_analysis.py), each route's schools and
disadvantaged tracts within 150 m come from it: REAL locations beside an
ILLUSTRATIVE route, replacing the service's two hand-drawn SYNTHETIC zones.
If the segment lines have changed since that analysis ran, its counts are left
out and this script says so; rerun the corridor analysis to bring them back.
"""

import hashlib
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request

SERVICE = (
    "https://services.arcgis.com/QPnoxtBFXm6yYtyc/arcgis/rest/services/"
    "PortPlan_%E2%80%94_Disruption_Triage_WFL1/FeatureServer"
)
LAYER_SEGMENTS, LAYER_FACILITIES, LAYER_SHIPMENT_ROUTES = 0, 1, 2

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "data"
LABEL = "SIMULATED"

# The service stores each route as one merged line, not as a list of segments.
# The segment order is recorded here and checked against the service's miles.
ROUTES = [
    ("R-A-ORIG", "WH-A", "original", ["PORT-01", "NB-03", "WH-A-APPR"]),
    ("R-A-ALT", "WH-A", "alternative", ["PORT-01", "EB-405", "WH-A-APPR"]),
    ("R-B-ORIG", "WH-B", "original", ["PORT-01", "NB-03", "WH-B-APPR"]),
    ("R-B-ALT", "WH-B", "alternative", ["HARBOR-110", "XTOWN-B"]),
    ("R-C-ORIG", "WH-C", "original", ["PORT-01", "WEST-405"]),
    ("R-C-ALT", "WH-C", "alternative", ["C-LOCAL"]),
]
ORIGIN = "PORT-LB"
REFERENCE_SHIPMENT = "S-01"

# Pickup handling is still a team placeholder. The cost and CO2 inputs are
# published figures kept, with their sources, in assumptions.json.
PICKUP_HANDLING_MIN = 30
TRUCK_LEAD_MIN = 15  # truck is available this long before the cargo is ready


# ---------------------------------------------------------------- helpers


def fetch(layer, where="1=1"):
    query = urllib.parse.urlencode(
        {"where": where, "outFields": "*", "outSR": "4326", "f": "json", "orderByFields": "OBJECTID"}
    )
    with urllib.request.urlopen(f"{SERVICE}/{layer}/query?{query}", timeout=60) as response:
        data = json.load(response)
    if "error" in data:
        raise SystemExit(f"Feature service error on layer {layer}: {data['error']}")
    return data["features"]


def to_min(hhmm):
    return int(hhmm[:2]) * 60 + int(hhmm[3:5])


def to_hhmm(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def span(low, high, unit=""):
    """'12:00' or '12:00 to 12:12'; with a unit, '60 min' or '58 to 60 min'."""
    suffix = f" {unit}" if unit else ""
    return f"{low}{suffix}" if low == high else f"{low} to {high}{suffix}"


def time_span(low, high):
    return span(to_hhmm(low), to_hhmm(high))


RISK_WORDS = {"ON_TRACK": "on track", "TIGHT": "tight", "LATE": "late"}


def lateness_words(late_min, late_max):
    if late_max == 0:
        return "Meets window"
    if late_min > 0:
        return f"{span(late_min, late_max, 'min')} late"
    return f"May be up to {late_max} min late"


# ------------------------------------------------------ community counts


def fingerprint(segments):
    """Changes whenever a segment line changes, so a stale corridor analysis is caught."""
    lines = {s["id"]: s["geometry"]["coordinates"] for s in segments}
    return hashlib.sha256(json.dumps(lines, sort_keys=True).encode()).hexdigest()[:16]


def community_note(schools, tracts, buffer_m=150):
    """The sentence the dashboard shows for real community counts."""

    def plural(n, one, many):
        return f"{n} {one if n == 1 else many}"

    return (
        f"{plural(schools, 'school', 'schools')} and "
        f"{plural(tracts, 'disadvantaged tract', 'disadvantaged tracts')} within {buffer_m} m "
        "(real locations, illustrative route)"
    )


def apply_corridor(files, corridor):
    """Copy the corridor analysis into segments, routes and the sample responses.

    Works on the same dictionaries whether they were just built from the feature
    service or read back from src/data, so both scripts give the same files.
    """
    segments = files["segments.json"]["items"]
    routes = {r["id"]: r for r in files["routes.json"]["items"]}
    buffer_m = corridor["buffer_m"]

    for segment in segments:
        near = corridor["segments"][segment["id"]]
        segment["near_sensitive_zone"] = near["near_sensitive_zone"]
        segment["sensitive_zone_note"] = (
            community_note(len(near["schools"]), len(near["dac_tracts"]), buffer_m)
            if near["near_sensitive_zone"]
            else ""
        )

    old_notes = {route_id: route["sensitive_zone_note"] for route_id, route in routes.items()}
    for route_id, route in routes.items():
        counted = corridor["routes"][route_id]
        route["near_sensitive_zone"] = counted["near_sensitive_zone"]
        route["sensitive_zone_note"] = counted["note"] if counted["near_sensitive_zone"] else ""
        route["schools_150m"] = counted["schools_150m"]
        route["dac_tracts"] = counted["dac_tracts"]
        route["max_diesel_pm_pctl"] = counted["max_diesel_pm_pctl"]

    disrupted = files["sample-responses.json"]["scenarios"]["disrupted"]
    for shipment in files["shipments.json"]["items"]:
        original = routes[shipment["assigned_route_id"]]
        alternative = next(
            r for r in routes.values() if r["destination"] == shipment["destination_id"] and r["kind"] == "alternative"
        )
        for option in disrupted[shipment["id"]]["options"]:
            if option["kind"] == "wait":
                option["passes_sensitive_zone"] = original["near_sensitive_zone"]
            elif option["kind"] == "reroute" and option["miles"] is not None:
                option["passes_sensitive_zone"] = alternative["near_sensitive_zone"]
                notes = [n for n in option["stakeholder_notes"] if n not in (old_notes[alternative["id"]], alternative["sensitive_zone_note"])]
                if alternative["sensitive_zone_note"]:
                    notes.append(alternative["sensitive_zone_note"])
                option["stakeholder_notes"] = notes


def load_corridor(files):
    """The stored corridor analysis, or None when it is missing or out of date."""
    path = OUT / "corridor.json"
    if not path.exists():
        return None
    corridor = json.loads(path.read_text())
    if corridor["geometry_fingerprint"] != fingerprint(files["segments.json"]["items"]):
        print(
            "WARNING: the segment lines have changed since the corridor analysis ran, so its community counts "
            "were left out. Run: python3 scripts/corridor_analysis.py"
        )
        return None
    return corridor


# ------------------------------------------------------------- the rules


def walk(route, segments, depart, incident, which):
    """Arrival time and minutes waited at the closure, for min or max travel times."""
    now, waited, reached = depart, 0, None
    for segment_id in route["segment_ids"]:
        if incident and segment_id == incident["segment_id"]:
            reached = now
            start, reopen = to_min(incident["start_time"]), to_min(incident["reported_reopen_time"])
            if start <= now < reopen:  # reaches the closure before it reopens: wait
                waited = reopen - now
                now = reopen
        now += segments[segment_id][which]
    return now, waited, reached


def evaluate(route, segments, shipment, depart, incident, assumptions):
    arrive_min, wait_at_min, reach_min = walk(route, segments, depart, incident, "minutes_min")
    arrive_max, wait_at_max, reach_max = walk(route, segments, depart, incident, "minutes_max")
    start, end = to_min(shipment["appt_start"]), to_min(shipment["appt_end"])

    def lateness(arrival):  # service must start by appt_end; early arrivals wait
        return max(0, max(arrival, start) - end)

    late_min, late_max = lateness(arrive_min), lateness(arrive_max)
    risk = "ON_TRACK" if late_max == 0 else ("TIGHT" if late_min == 0 else "LATE")
    miles = route["total_miles"]
    duty = arrive_max - depart  # max-arrival case, including waiting at the closure
    cost = miles * assumptions["nonlabor_cost_per_mile"] + duty / 60 * assumptions["labor_rate_per_hr"]
    co2 = miles / assumptions["mpg"] * assumptions["diesel_kgCO2_per_gal"]
    return {
        "arrive_min": arrive_min,
        "arrive_max": arrive_max,
        "late_min": late_min,
        "late_max": late_max,
        "risk": risk,
        "miles": miles,
        "duty": duty,
        "cost_exact": cost,
        "co2_exact": co2,
        "cost": round(cost),
        "co2_kg": round(co2, 1),
        # A faster truck reaches the closure sooner and so waits longer.
        "wait_low": min(wait_at_min, wait_at_max),
        "wait_high": max(wait_at_min, wait_at_max),
        "reach_low": reach_min,
        "reach_high": reach_max,
        "affected": max(wait_at_min, wait_at_max) > 0,
    }


def summary_of(result, reason):
    return {
        "arrival_min": to_hhmm(result["arrive_min"]),
        "arrival_max": to_hhmm(result["arrive_max"]),
        "lateness_min": result["late_min"],
        "lateness_max": result["late_max"],
        "risk": result["risk"],
        "reason": reason,
        "affected": result["affected"],
    }


def option_of(kind, result, status, steps, notes, passes_zone=False, confirm=False):
    return {
        "kind": kind,
        "arrival_min": to_hhmm(result["arrive_min"]) if result else None,
        "arrival_max": to_hhmm(result["arrive_max"]) if result else None,
        "lateness_min": result["late_min"] if result else None,
        "lateness_max": result["late_max"] if result else None,
        "risk": result["risk"] if result else "UNKNOWN",
        "miles": result["miles"] if result else None,
        "cost": result["cost"] if result else None,
        "co2_kg": result["co2_kg"] if result else None,
        "requires_confirmation": confirm,
        "status": status,
        "explanation_inputs": steps,
        "driver_duty_min": result["duty"] if result else None,
        "passes_sensitive_zone": passes_zone,
        "stakeholder_notes": notes,
    }


# --------------------------------------------------------------- building


def build():
    seg_features = fetch(LAYER_SEGMENTS)
    fac_features = fetch(LAYER_FACILITIES)
    row_features = fetch(LAYER_SHIPMENT_ROUTES)

    facilities = [
        {
            "id": f["attributes"]["id"],
            "name": f["attributes"]["name"],
            "type": f["attributes"]["type"],
            "lat": round(f["geometry"]["y"], 5),
            "lon": round(f["geometry"]["x"], 5),
        }
        for f in fac_features
    ]

    segments, incident, truck_note = {}, None, ""
    for f in seg_features:
        a = f["attributes"]
        path = max(f["geometry"]["paths"], key=len)
        segments[a["id"]] = {
            "id": a["id"],
            "name": a["name"],
            "geometry": {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in path]},
            "miles": a["miles"],
            "minutes_min": int(a["minutes_min"]),
            "minutes_max": int(a["minutes_max"]),
            # The service stores booleans as the strings "0" and "-1".
            "near_sensitive_zone": str(a["near_sensitive_zone"]) not in ("0", "", "None"),
            "sensitive_zone_note": a["sensitive_zone_note"] or "",
        }
        truck_note = a.get("label") or truck_note
        closed = re.match(r"CLOSED (\d\d:\d\d), reported reopen (\d\d:\d\d)", a.get("disrupted_status") or "")
        if closed:
            incident = {
                "segment_id": a["id"],
                "type": "closure",
                "start_time": closed.group(1),
                "reported_reopen_time": closed.group(2),
                "assumed_reopen_time": None,
                "evidence_text": (
                    f"SIMULATED report: {a['id']} ({a['name']}) closed from {closed.group(1)}; "
                    f"crews report reopening at {closed.group(2)}."
                ),
                "confirmed_by_user": True,
            }
    if incident is None:
        raise SystemExit("No closed segment found in the service's disrupted_status field.")

    routes = {}
    for route_id, destination, kind, segment_ids in ROUTES:
        parts = [segments[s] for s in segment_ids]
        notes = [p["sensitive_zone_note"] for p in parts if p["sensitive_zone_note"]]
        routes[route_id] = {
            "id": route_id,
            "origin": ORIGIN,
            "destination": destination,
            "segment_ids": segment_ids,
            "kind": kind,
            "truck_suitability_note": truck_note or "ILLUSTRATIVE - not verified for trucks",
            "near_sensitive_zone": any(p["near_sensitive_zone"] for p in parts),
            "sensitive_zone_note": "; ".join(notes),
            "schools_150m": None,
            "dac_tracts": None,
            "max_diesel_pm_pctl": None,
            "total_miles": sum(p["miles"] for p in parts),
            "total_minutes_min": sum(p["minutes_min"] for p in parts),
            "total_minutes_max": sum(p["minutes_max"] for p in parts),
        }

    assumptions_path = OUT / "assumptions.json"
    assumptions = json.loads(assumptions_path.read_text())
    assumptions["pickup_handling_min"] = PICKUP_HANDLING_MIN

    rows = [f["attributes"] for f in row_features]
    normal_rows = [r for r in rows if r["scenario"] == "Normal"]

    shipments, departures = [], {}
    for r in sorted(normal_rows, key=lambda r: r["shipment"]):
        route = routes[r["route_id"]]
        arrival_low = to_min(r["arrival_range"].split("-")[0])
        depart = arrival_low - route["total_minutes_min"]
        cargo_ready = depart - PICKUP_HANDLING_MIN
        appt_start, appt_end = r["appointment"].split("-")
        shipments.append(
            {
                "id": r["shipment"],
                "destination_id": r["destination"],
                "cargo_ready": to_hhmm(cargo_ready),
                "truck_available": to_hhmm(cargo_ready - TRUCK_LEAD_MIN),
                "appt_start": appt_start,
                "appt_end": appt_end,
                "assigned_route_id": r["route_id"],
            }
        )
        departures[r["shipment"]] = depart

    closed_id, reopen = incident["segment_id"], incident["reported_reopen_time"]
    baselines, normal, disrupted, computed = {}, {}, {}, {}

    for s in shipments:
        sid, depart = s["id"], departures[s["id"]]
        original = routes[s["assigned_route_id"]]
        alternative = next(
            r for r in routes.values() if r["destination"] == s["destination_id"] and r["kind"] == "alternative"
        )
        deadline = s["appt_end"]

        base = evaluate(original, segments, s, depart, None, assumptions)
        baselines[sid] = {
            "miles": base["miles"],
            "cost": base["cost"],
            "co2_kg": base["co2_kg"],
            "driver_duty_min": base["duty"],
        }
        normal[sid] = {
            "summary": summary_of(
                base,
                f"Departs {to_hhmm(depart)}, arrives {time_span(base['arrive_min'], base['arrive_max'])}, "
                f"deadline {deadline}: {RISK_WORDS[base['risk']]}.",
            ),
            "options": [],
        }

        wait = evaluate(original, segments, s, depart, incident, assumptions)
        computed[sid] = {"normal": base, "wait": wait, "reroute": None}
        arrives = time_span(wait["arrive_min"], wait["arrive_max"])

        if not wait["affected"]:
            if closed_id in original["segment_ids"]:
                when = "after the reported reopening" if wait["reach_low"] >= to_min(reopen) else "before the closure"
                reason = (
                    f"Reaches {closed_id} at {time_span(wait['reach_low'], wait['reach_high'])}, {when}; "
                    f"not affected. Arrives {arrives}: {RISK_WORDS[wait['risk']]}."
                )
            else:
                reason = f"Route does not use {closed_id}; not affected. Arrives {arrives}: {RISK_WORDS[wait['risk']]}."
            disrupted[sid] = {"summary": summary_of(wait, reason), "options": []}
            continue

        waited = span(wait["wait_low"], wait["wait_high"], "min")
        reason = (
            f"Waits {waited} at {closed_id} until {reopen}, arrives {arrives}, "
            f"deadline {deadline}: {RISK_WORDS[wait['risk']]}."
        )
        wait_option = option_of(
            "wait",
            wait,
            f"Estimate: assumes {closed_id} reopens at the reported {reopen}",
            [
                f"Departs {to_hhmm(depart)}",
                f"Reaches {closed_id} at {time_span(wait['reach_low'], wait['reach_high'])}",
                f"{closed_id} closed from {incident['start_time']}, reported reopening {reopen}",
                f"Waits until {reopen} ({waited})",
                f"Arrives {arrives}",
                f"Deadline {deadline}",
                lateness_words(wait["late_min"], wait["late_max"]),
            ],
            [
                f"Driver duty up to {wait['duty']} min including up to {wait['wait_high']} min waiting",
                f"Warehouse {s['destination_id']}: {lateness_words(wait['late_min'], wait['late_max']).lower()}",
            ],
            passes_zone=original["near_sensitive_zone"],
        )

        alt_segments = ", ".join(alternative["segment_ids"])
        if closed_id in alternative["segment_ids"]:
            reroute_option = option_of(
                "reroute",
                None,
                f"Unavailable: alternative route {alternative['id']} also uses closed segment {closed_id}",
                [
                    f"Alternative route {alternative['id']}: {alt_segments}",
                    f"Uses {closed_id}, which is closed",
                    "No other alternative route in the sample data",
                ],
                [],
            )
        else:
            reroute = evaluate(alternative, segments, s, depart, incident, assumptions)
            computed[sid]["reroute"] = reroute
            notes = [
                f"+{reroute['miles'] - wait['miles']} mi and "
                f"+{round(reroute['co2_kg'] - wait['co2_kg'], 1)} kg CO2 versus the original route"
            ]
            if alternative["sensitive_zone_note"]:
                notes.append(alternative["sensitive_zone_note"])
            reroute_option = option_of(
                "reroute",
                reroute,
                f"Estimate: alternative route {alternative['id']} avoids {closed_id}",
                [
                    f"Departs {to_hhmm(depart)}",
                    f"Takes {alternative['id']} ({alt_segments}), avoids {closed_id}",
                    f"{alternative['total_miles']} mi, "
                    f"{span(alternative['total_minutes_min'], alternative['total_minutes_max'], 'min')}",
                    f"Arrives {time_span(reroute['arrive_min'], reroute['arrive_max'])}",
                    f"Deadline {deadline}",
                    lateness_words(reroute["late_min"], reroute["late_max"]),
                ],
                notes,
                passes_zone=alternative["near_sensitive_zone"],
            )

        slot_option = option_of(
            "request_slot",
            None,
            "Pending confirmation; original deadline still applies",
            [
                f"Ask {s['destination_id']} for a later appointment",
                "Not confirmed by the warehouse",
                f"Original deadline {deadline} still applies",
                f"Risk stays {wait['risk'].replace('_', ' ')} until confirmed",
            ],
            [f"Warehouse {s['destination_id']} must confirm a new slot"],
            confirm=True,
        )
        slot_option["risk"] = wait["risk"]  # a pending request never improves risk

        disrupted[sid] = {"summary": summary_of(wait, reason), "options": [wait_option, reroute_option, slot_option]}

    files = {
        "facilities.json": {"label": LABEL, "source": SERVICE, "items": facilities},
        "segments.json": {"label": LABEL, "source": SERVICE, "items": list(segments.values())},
        "routes.json": {"label": LABEL, "source": SERVICE, "items": list(routes.values())},
        "shipments.json": {"label": LABEL, "source": SERVICE, "items": shipments},
        "assumptions.json": assumptions,
        "sample-responses.json": {
            "label": LABEL,
            "note": (
                "Pre-calculated by scripts/import_map_data.py from the team's feature service. "
                "Replaced by engine output in E3/E4."
            ),
            "reference_shipment_id": REFERENCE_SHIPMENT,
            "incident": incident,
            "baselines": baselines,
            "scenarios": {"normal": normal, "disrupted": disrupted},
        },
    }
    corridor = load_corridor(files)
    if corridor:
        apply_corridor(files, corridor)
    return files, rows, routes, computed


# -------------------------------------------------------------- verifying


def verify(rows, routes, computed):
    """Compare our results with the service's own rows for all three scenarios."""
    problems = []
    risk_text = {"ON_TRACK": "ON TRACK", "TIGHT": "TIGHT", "LATE": "LATE"}

    def check(tag, field, ours, theirs):
        if ours != theirs:
            problems.append(f"{tag}: {field} is {ours} here but {theirs} in the service")

    for r in rows:
        sid, scenario = r["shipment"], r["scenario"]
        tag = f"{sid} [{scenario}]"
        if scenario == "Normal":
            result = computed[sid]["normal"]
        elif r["route_kind"] == "alternative":
            result = computed[sid]["reroute"]
        else:
            result = computed[sid]["wait"]
        if result is None:
            problems.append(f"{tag}: the service shows a reroute but none was calculated")
            continue
        check(tag, "arrival", f"{to_hhmm(result['arrive_min'])}-{to_hhmm(result['arrive_max'])}", r["arrival_range"])
        check(tag, "lateness (max)", result["late_max"], int(r["lateness_max_min"]))
        check(tag, "risk", risk_text[result["risk"]], r["risk"])
        check(tag, "miles", result["miles"], r["miles"])
        # The service's co2_kg and cost_max_usd columns were calculated with the
        # earlier placeholder rates ($1.80 per mile, $40 per hour, 6.5 mpg). The
        # app now uses the sourced inputs in assumptions.json, so those two
        # columns are no longer compared. Timing, risk and miles still are.
        check(tag, "route miles", routes[r["route_id"]]["total_miles"], r["miles"])
    return problems


def main():
    check_only = "--check" in sys.argv
    files, rows, routes, computed = build()
    problems = verify(rows, routes, computed)
    if not check_only:
        OUT.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (OUT / name).write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n")
        print(f"Wrote {len(files)} files to {OUT}")
    print(f"Compared {len(rows)} service rows: {len(problems)} mismatches")
    for problem in problems:
        print("  -", problem)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
