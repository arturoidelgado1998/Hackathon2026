#!/usr/bin/env python3
"""Import REAL Caltrans reference data for the project's corridors into src/data/real.

Two public Caltrans sources, both read without an account:

1. Lane Closure System, District 7: planned and current lane closures.
   Kept as dated examples of what real closures on these highways look like,
   and as the start of a record of planned against actual closure times.
2. Truck Network: the truck designation Caltrans records for each state highway.

This is reference data. The app does not calculate with it, it is not a live
feed (it is a snapshot taken when this script runs), and nothing here says a
route is legal or suitable for trucks. Segments and routes stay SIMULATED and
illustrative; these files are labelled REAL so the two are never mixed up.

Usage (Python 3.9+, standard library only):

    python3 scripts/import_reference_data.py           # fetch and write src/data/real
    python3 scripts/import_reference_data.py --check   # fetch and report only

Run scripts/import_map_data.py first: this script reads src/data/segments.json.

Each run merges into lane-closures.json: closures seen before are kept and
updated, so running it on later days builds up actual start and end times.
The feed changes all the time, so two runs do not give the same file.
"""

import datetime
import json
import math
import pathlib
import sys
import urllib.parse
import urllib.request

DATA = pathlib.Path(__file__).resolve().parent.parent / "src" / "data"
OUT = DATA / "real"
LABEL = "REAL"

LCS_URL = "https://cwwp2.dot.ca.gov/data/d7/lcs/lcsStatusD07.json"
TRUCK_URL = "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Truck_Network/FeatureServer/0"

# Which state highway, in which direction of travel, each segment follows.
# This is the importer's reading of the segment names and drawn lines in the
# team's feature service; the service does not store it. A segment with no
# entry here stops the import, so a renamed or new segment is never skipped.
# C-LOCAL is surface streets, which neither Caltrans source covers.
SEGMENT_HIGHWAYS = {
    "PORT-01": [("I-710", "North")],
    "NB-03": [("I-710", "North"), ("SR-60", "East")],
    "WH-A-APPR": [("SR-60", "East")],
    "EB-405": [("I-405", "South"), ("I-605", "North")],
    "WH-B-APPR": [("I-605", "North")],
    "HARBOR-110": [("I-110", "North")],
    "XTOWN-B": [("I-10", "East")],
    "WEST-405": [("I-405", "North")],
    "C-LOCAL": [],
}

# The drawn segment lines are schematic (a few points along the corridor), so
# matching is by highway number first and by distance second, with wide limits.
CLOSURE_MAX_KM = 3.0  # closure start point to the segment's drawn line
TRUCK_MAX_KM = 2.5  # truck network line to the segment's drawn line
SAMPLE_KM = 0.5  # spacing of the points checked along each segment
MIN_SHARE = 0.05  # ignore a truck network stretch that only touches a segment

# Closures kept: the lanes a through truck drives on. Ramp closures are counted
# but not stored, because the illustrative routes do not say which ramps they use.
THROUGH_FACILITIES = ("Mainline", "Connector", "HOV", "HOV Connector")

# Caltrans truck network map legend. Stored next to the raw code so a reader
# can check it; the map layer itself carries only the codes.
DESIGNATIONS = {
    "NN": "National Network (STAA trucks)",
    "TA": "Terminal Access (STAA trucks)",
    "CL": "California Legal trucks only",
    "A": "California Legal, advisory route",
}


# ---------------------------------------------------------------- helpers


def fetch_json(url, params=None):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "portplan-import"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.loads(response.read().decode("utf-8-sig"))
    if isinstance(data, dict) and "error" in data:
        raise SystemExit(f"Service error from {url}: {data['error']}")
    return data


def load_segments():
    path = DATA / "segments.json"
    if not path.exists():
        raise SystemExit("src/data/segments.json is missing. Run scripts/import_map_data.py first.")
    segments = {s["id"]: s for s in json.loads(path.read_text())["items"]}
    missing = sorted(set(segments) - set(SEGMENT_HIGHWAYS))
    extra = sorted(set(SEGMENT_HIGHWAYS) - set(segments))
    if missing or extra:
        raise SystemExit(
            "SEGMENT_HIGHWAYS in this script is out of date. "
            f"Segments with no entry: {missing or 'none'}. Entries with no segment: {extra or 'none'}."
        )
    return segments


def to_km(lon, lat):
    """Flat-map kilometres. Accurate to well under 1% across the study area."""
    return (lon * 111.32 * math.cos(math.radians(33.9)), lat * 110.57)


def line_km(segment):
    return [to_km(lon, lat) for lon, lat in segment["geometry"]["coordinates"]]


def distance_to_line(point, line):
    """Shortest distance in km from a point to a line of straight pieces."""
    px, py = point
    best = math.inf
    for (ax, ay), (bx, by) in zip(line, line[1:]):
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        t = 0 if length_sq == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length_sq))
        best = min(best, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
    return best


def sample_points(line):
    """Points every SAMPLE_KM along a line, including both ends."""
    points = [line[0]]
    for (ax, ay), (bx, by) in zip(line, line[1:]):
        steps = max(1, round(math.hypot(bx - ax, by - ay) / SAMPLE_KM))
        points += [(ax + (bx - ax) * i / steps, ay + (by - ay) * i / steps) for i in range(1, steps + 1)]
    return points


def route_number(name):
    """'I-710' -> '710'; the truck network stores the number only."""
    return name.split("-")[-1].lstrip("0")


def when(date, time):
    """Feed date and time (Pacific local) as 'YYYY-MM-DDTHH:MM', or None when blank."""
    return f"{date}T{time[:5]}" if date and time else None


def minutes_between(start, end):
    fmt = "%Y-%m-%dT%H:%M"
    delta = datetime.datetime.strptime(end, fmt) - datetime.datetime.strptime(start, fmt)
    return round(delta.total_seconds() / 60)


# ----------------------------------------------------------- lane closures


def match_segment(route, direction, lon, lat, segments):
    """The segment a closure sits on: same highway and direction, nearest within the limit."""
    point = to_km(lon, lat)
    best_id, best_km = None, CLOSURE_MAX_KM
    for segment_id, highways in SEGMENT_HIGHWAYS.items():
        if not any(route == r and d in direction for r, d in highways):
            continue
        km = distance_to_line(point, line_km(segments[segment_id]))
        if km <= best_km:
            best_id, best_km = segment_id, km
    return best_id


def closure_status(closure):
    # Caltrans radio codes: 10-97 closure in place, 10-98 picked up, 10-22 cancelled.
    if closure["code1022"]["isCode1022"] == "true":
        return "cancelled"
    if closure["code1098"]["isCode1098"] == "true":
        return "completed"
    if closure["code1097"]["isCode1097"] == "true":
        return "in_place"
    return "planned"


def closure_item(record, segments, today):
    begin, end = record["location"]["begin"], record["location"]["end"]
    closure, stamp = record["closure"], record["closure"]["closureTimestamp"]
    route, direction = begin["beginRoute"], record["location"]["travelFlowDirection"]
    try:
        lon, lat = float(begin["beginLongitude"]), float(begin["beginLatitude"])
    except ValueError:
        return None
    segment_id = match_segment(route, direction, lon, lat, segments)
    if segment_id is None:
        return None

    indefinite = stamp["isClosureEndIndefinite"] == "true"
    planned_start = when(stamp["closureStartDate"], stamp["closureStartTime"])
    planned_end = None if indefinite else when(stamp["closureEndDate"], stamp["closureEndTime"])
    started = closure["code1097"]["code1097Timestamp"]
    ended = closure["code1098"]["code1098Timestamp"]
    actual_start = when(started["code1097Date"], started["code1097Time"])
    actual_end = when(ended["code1098Date"], ended["code1098Time"])
    status = closure_status(closure)

    lanes = closure["lanesClosed"]
    what = "all lanes" if lanes == "All" else f"lanes {lanes} of {closure['totalExistingLanes']}"
    period = f"{planned_start.replace('T', ' ')} to {planned_end.replace('T', ' ') if planned_end else 'no end date'}"
    return {
        "id": record["index"],
        "segment_id": segment_id,
        "route": route,
        "direction": direction,
        "facility": closure["facility"],
        "closure_type": closure["typeOfClosure"],
        "work_type": closure["typeOfWork"],
        "lanes_closed": lanes,
        "total_lanes": closure["totalExistingLanes"],
        "from": begin["beginLocationName"],
        "to": end["endLocationName"],
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        "planned_start": planned_start,
        "planned_end": planned_end,
        "actual_start": actual_start,
        "actual_end": actual_end,
        "status": status,
        # Minutes the closure stayed past its planned end; negative when it ended early.
        "ran_over_min": minutes_between(planned_end, actual_end) if status == "completed" and planned_end and actual_end else None,
        "summary": (
            f"{route} {direction}, {closure['facility'].lower()}: {what} closed "
            f"from {begin['beginLocationName']} to {end['endLocationName']}, {period}, {closure['typeOfWork'].lower()}."
        ),
        "first_seen": today,
        "last_seen": today,
    }


def build_closures(segments, now):
    today = now.strftime("%Y-%m-%d")
    feed = [row["lcs"] for row in fetch_json(LCS_URL)["data"]]
    current, ramps_left_out = {}, 0
    for record in feed:
        item = closure_item(record, segments, today)
        if item and item["facility"] in THROUGH_FACILITIES:
            current[item["id"]] = item
        elif item:
            ramps_left_out += 1

    # Keep closures seen on earlier runs, so actual times build up over days.
    path = OUT / "lane-closures.json"
    kept = 0
    if path.exists():
        for old in json.loads(path.read_text())["items"]:
            if old["id"] in current:
                current[old["id"]]["first_seen"] = old["first_seen"]
            elif match_segment(old["route"], old["direction"], old["lon"], old["lat"], segments) == old["segment_id"]:
                current[old["id"]] = old
                kept += 1

    items = sorted(current.values(), key=lambda i: (i["planned_start"] or "", i["id"]))
    by_segment = {s: sum(1 for i in items if i["segment_id"] == s) for s in SEGMENT_HIGHWAYS}
    by_status = {s: sum(1 for i in items if i["status"] == s) for s in ("planned", "in_place", "completed", "cancelled")}
    ran_over = [i["ran_over_min"] for i in items if i["ran_over_min"] is not None]
    return {
        "label": LABEL,
        "source_name": "Caltrans Lane Closure System, District 7",
        "source": LCS_URL,
        "retrieved": now.strftime("%Y-%m-%dT%H:%MZ"),
        "note": (
            "Snapshot of planned and current Caltrans lane closures on the highways the SIMULATED segments follow. "
            "Reference only: not a live feed, and not used in any calculation. Times are Pacific local time. "
            "Most rows are planned roadwork; this is not a record of crashes or emergency closures."
        ),
        "matching": (
            f"A closure belongs to a segment when it is on the same highway and direction and starts within "
            f"{CLOSURE_MAX_KM:g} km of the segment's drawn line. Segment lines are schematic, so this is approximate. "
            "Only mainline, connector and HOV closures are stored; ramp closures are counted in "
            "counts.ramp_closures_left_out. A closure no longer in the feed keeps the status it had when last seen."
        ),
        "counts": {
            "in_feed": len(feed),
            "on_project_segments": len(items),
            "ramp_closures_left_out": ramps_left_out,
            "kept_from_earlier_runs": kept,
            "by_segment": by_segment,
            "by_status": by_status,
            "with_actual_end": len(ran_over),
            "ran_past_planned_end": sum(1 for m in ran_over if m > 0),
        },
        "items": items,
    }


# ----------------------------------------------------------- truck network


def build_truck_network(segments, now):
    lons = [lon for s in segments.values() for lon, _ in s["geometry"]["coordinates"]]
    lats = [lat for s in segments.values() for _, lat in s["geometry"]["coordinates"]]
    pad = 0.05
    features = fetch_json(
        f"{TRUCK_URL}/query",
        {
            "where": "1=1",
            "outFields": "*",
            "outSR": "4326",
            "geometry": f"{min(lons) - pad},{min(lats) - pad},{max(lons) + pad},{max(lats) + pad}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "orderByFields": "OBJECTID",
            "f": "json",
        },
    )["features"]
    recorded_routes = {f["attributes"]["RT"].strip().lstrip("0") for f in features}

    items = []
    for segment_id, highways in SEGMENT_HIGHWAYS.items():
        samples = sample_points(line_km(segments[segment_id]))
        covered = [False] * len(samples)
        # Caltrans splits a highway at county lines and junctions. Stretches of one
        # highway with the same designation are reported together.
        groups = {}
        for feature in features:
            a = feature["attributes"]
            names = [name for name, _ in highways if route_number(name) == a["RT"].strip().lstrip("0")]
            if not names:
                continue
            vertices = [to_km(x, y) for path in feature["geometry"]["paths"] for x, y in path]
            near = [any(math.hypot(sx - vx, sy - vy) <= TRUCK_MAX_KM for vx, vy in vertices) for sx, sy in samples]
            if sum(near) / len(samples) < MIN_SHARE:
                continue
            covered = [c or n for c, n in zip(covered, near)]
            code = a["DESIG"].strip()
            restricted = a["SP_RESTR"].strip() == "R"
            note = a["COMMENT"].strip() if restricted else ""
            key = (names[0], code, restricted, note, a["KPRA"].strip())
            group = groups.setdefault(key, {"near": [False] * len(samples), "recorded": []})
            group["near"] = [g or n for g, n in zip(group["near"], near)]
            group["recorded"].append(f"{a['BEGIN_LOCA'].strip()} to {a['END_LOCATI'].strip()}")
        stretches = [
            {
                "highway": highway,
                "designation": code or None,
                "designation_meaning": DESIGNATIONS.get(code),
                "special_restriction": restricted,
                "restriction_note": note,
                "kpra_advisory_ft": kpra or None,
                "share_of_segment": round(sum(group["near"]) / len(samples), 2),
                "recorded_stretches": sorted(group["recorded"]),
            }
            for (highway, code, restricted, note, kpra), group in groups.items()
        ]
        stretches.sort(key=lambda s: (-s["share_of_segment"], s["highway"], s["designation"] or ""))
        no_record = sorted({name for name, _ in highways if route_number(name) not in recorded_routes})

        parts = [
            f"{s['highway']}: "
            + (s["designation_meaning"] or "no designation recorded")
            + (f"; restriction: {s['restriction_note']}" if s["special_restriction"] else "")
            for s in stretches
        ]
        if no_record:
            parts.append(f"No record in this layer for {', '.join(no_record)}")
        if not highways:
            parts.append("Surface streets: not covered by the state highway layer")
        items.append(
            {
                "segment_id": segment_id,
                "highways": [f"{name} {direction}" for name, direction in highways],
                "stretches": stretches,
                "no_record_for": no_record,
                "share_with_record": round(sum(covered) / len(samples), 2),
                "note": ". ".join(parts) + ".",
            }
        )

    return {
        "label": LABEL,
        "source_name": "Caltrans Truck Network (state highways)",
        "source": TRUCK_URL,
        "retrieved": now.strftime("%Y-%m-%dT%H:%MZ"),
        "note": (
            "The truck designation Caltrans records for the state highways each SIMULATED segment follows. "
            "Reference only. The segments and routes are illustrative, so this is not a check that a truck "
            "may use them, and a missing record does not mean trucks are barred."
        ),
        "matching": (
            f"A recorded stretch is listed for a segment when it is on a highway the segment follows and lies within "
            f"{TRUCK_MAX_KM:g} km of at least {MIN_SHARE:.0%} of the segment's drawn line. Segment lines are schematic, "
            "so shares are approximate."
        ),
        "designations": DESIGNATIONS,
        "items": items,
    }


# -------------------------------------------------------------------- main


def main():
    check_only = "--check" in sys.argv
    segments = load_segments()
    now = datetime.datetime.now(datetime.timezone.utc)
    closures = build_closures(segments, now)
    trucks = build_truck_network(segments, now)

    if not check_only:
        OUT.mkdir(parents=True, exist_ok=True)
        for name, content in (("lane-closures.json", closures), ("truck-network.json", trucks)):
            (OUT / name).write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n")
        print(f"Wrote 2 files to {OUT}")

    counts = closures["counts"]
    print(
        f"Lane closures: {counts['on_project_segments']} of {counts['in_feed']} in the feed are on project segments "
        f"({counts['ramp_closures_left_out']} ramp closures left out)"
    )
    print(f"  by segment: {counts['by_segment']}")
    print(f"  by status: {counts['by_status']}")
    print(f"  with an actual end time: {counts['with_actual_end']} ({counts['ran_past_planned_end']} ran past the plan)")
    print("Truck network:")
    for item in trucks["items"]:
        print(f"  {item['segment_id']} ({item['share_with_record']:.0%} with a record): {item['note']}")


if __name__ == "__main__":
    main()
