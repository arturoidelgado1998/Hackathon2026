#!/usr/bin/env python3
"""Count the real schools and disadvantaged communities within 150 m of each route.

Two public layers are downloaded and compared with the drawn route lines:

- Public School Locations, Current (NCES, school year in the data)
- SB 535 Disadvantaged Communities 2022 (OEHHA, CalEPA)

The school and tract locations are REAL. The routes are ILLUSTRATIVE: their
lines are schematic. The result is a proximity measure along a drawn line. It
is not measured exposure and says nothing about health impact. The 150 m
distance follows Kozawa, Fruin and Winer (2009), who measured raised diesel
pollutants within about 150 m downwind of freeways near the two ports.

Usage (Python 3.9+, standard library only):

    python3 scripts/corridor_analysis.py           # analyse, write, then rebuild src/data
    python3 scripts/corridor_analysis.py --check   # analyse and report only

It reads the segment lines and routes already in src/data (written by
scripts/import_map_data.py), writes src/data/corridor.json (the counts) and
src/data/corridor-layers.json (the places, for the map), and copies the
counts into routes.json, segments.json and the sample responses so every file
agrees. Rerun it whenever the segment lines change; import_map_data.py leaves
the counts out, and says so, when they no longer match the lines.

The same layers and the same lines give the same result. Only the `retrieved`
date changes between runs.
"""

import datetime
import json
import math
import pathlib
import sys
import urllib.parse
import urllib.request

import import_map_data

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "data"
BUFFER_M = 150

SCHOOLS_URL = (
    "https://services1.arcgis.com/Ua5sjt3LWTPigjyD/arcgis/rest/services/"
    "Public_School_Locations_Current/FeatureServer/0"
)
TRACTS_URL = (
    "https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/"
    "SB_535_Disadvantaged_Communities_2022/FeatureServer/0"
)
PAGE = 2000  # both services return at most this many rows per request
BOX_PAD_DEG = 0.02  # study box: every segment line, padded by about 2 km


# -------------------------------------------------------------- projection


def albers(lon, lat):
    """Longitude and latitude to California Albers metres (EPSG:3310, GRS80)."""
    a, f = 6378137.0, 1 / 298.257222101
    e = math.sqrt(f * (2 - f))

    def q(phi):
        s = math.sin(phi)
        return (1 - e * e) * (s / (1 - e * e * s * s) - math.log((1 - e * s) / (1 + e * s)) / (2 * e))

    def m(phi):
        return math.cos(phi) / math.sqrt(1 - (e * math.sin(phi)) ** 2)

    phi1, phi2, phi0, lam0 = math.radians(34.0), math.radians(40.5), 0.0, math.radians(-120.0)
    n = (m(phi1) ** 2 - m(phi2) ** 2) / (q(phi2) - q(phi1))
    c = m(phi1) ** 2 + n * q(phi1)
    rho0 = a * math.sqrt(c - n * q(phi0)) / n
    rho = a * math.sqrt(c - n * q(math.radians(lat))) / n
    theta = n * (math.radians(lon) - lam0)
    return (rho * math.sin(theta), rho0 - rho * math.cos(theta) - 4_000_000.0)


# ---------------------------------------------------------------- geometry


def point_to_piece(p, a, b):
    """Distance in metres from point p to the straight piece a-b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_sq = dx * dx + dy * dy
    t = 0 if length_sq == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_sq))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def pieces_cross(a, b, c, d):
    def side(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    return side(a, b, c) * side(a, b, d) < 0 and side(c, d, a) * side(c, d, b) < 0


def piece_to_piece(a, b, c, d):
    if pieces_cross(a, b, c, d):
        return 0.0
    return min(point_to_piece(a, c, d), point_to_piece(b, c, d), point_to_piece(c, a, b), point_to_piece(d, a, b))


def point_to_line(p, line):
    return min(point_to_piece(p, a, b) for a, b in zip(line, line[1:]))


def inside(p, rings):
    """Even-odd test: is p inside a polygon given as outer and inner rings?"""
    hit = False
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            if (y1 > p[1]) != (y2 > p[1]) and p[0] < (x2 - x1) * (p[1] - y1) / (y2 - y1) + x1:
                hit = not hit
    return hit


def line_to_polygon(line, rings, box):
    """Distance in metres from a line to a polygon; 0 when they touch or overlap."""
    xs, ys = [p[0] for p in line], [p[1] for p in line]
    if (
        min(xs) - BUFFER_M > box[2]
        or max(xs) + BUFFER_M < box[0]
        or min(ys) - BUFFER_M > box[3]
        or max(ys) + BUFFER_M < box[1]
    ):
        return math.inf
    if any(inside(p, rings) for p in line):
        return 0.0
    return min(
        piece_to_piece(a, b, c, d)
        for a, b in zip(line, line[1:])
        for ring in rings
        for c, d in zip(ring, ring[1:])
    )


# --------------------------------------------------------------- downloads


def query(url, box, fields):
    """Every feature of a layer inside the box, as GeoJSON features, paging as needed."""
    features, offset = [], 0
    while True:
        params = urllib.parse.urlencode(
            {
                "where": "1=1",
                "geometry": ",".join(f"{v:.4f}" for v in box),
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "outFields": fields,
                "outSR": "4326",
                "orderByFields": "OBJECTID",
                "resultOffset": offset,
                "resultRecordCount": PAGE,
                "f": "geojson",
            }
        )
        with urllib.request.urlopen(f"{url}/query?{params}", timeout=120) as response:
            data = json.load(response)
        if "error" in data:
            raise SystemExit(f"Layer error from {url}: {data['error']}")
        page = data.get("features", [])
        features += page
        if len(page) < PAGE:
            return features
        offset += PAGE


def polygons_of(geometry):
    """A GeoJSON Polygon or MultiPolygon as a list of polygons, each a list of rings."""
    return [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]


# ---------------------------------------------------------------- analysis


def analyse(segments, routes, now):
    lons = [x for s in segments.values() for x, _ in s["geometry"]["coordinates"]]
    lats = [y for s in segments.values() for _, y in s["geometry"]["coordinates"]]
    box = (min(lons) - BOX_PAD_DEG, min(lats) - BOX_PAD_DEG, max(lons) + BOX_PAD_DEG, max(lats) + BOX_PAD_DEG)

    school_features = query(SCHOOLS_URL, box, "NAME,NCESSCH,CITY,SCHOOLYEAR")
    tract_features = query(TRACTS_URL, box, "Tract,Population,CIscoreP,Diesel_PM_Pctl")

    lines = {sid: [albers(x, y) for x, y in s["geometry"]["coordinates"]] for sid, s in segments.items()}

    schools = {}
    for f in school_features:
        lon, lat = f["geometry"]["coordinates"]
        p = f["properties"]
        schools[p["NCESSCH"]] = {
            "id": p["NCESSCH"],
            "name": p["NAME"],
            "city": p["CITY"],
            "lon": round(lon, 5),
            "lat": round(lat, 5),
            "xy": albers(lon, lat),
        }
    school_years = sorted({f["properties"]["SCHOOLYEAR"] for f in school_features if f["properties"]["SCHOOLYEAR"]})

    tracts = {}
    for f in tract_features:
        p = f["properties"]
        tract_id = str(int(p["Tract"]))
        polygons = polygons_of(f["geometry"])
        projected = [[[albers(x, y) for x, y in ring] for ring in polygon] for polygon in polygons]
        tracts[tract_id] = {
            "id": tract_id,
            "population": p["Population"],
            "ces_percentile": None if p["CIscoreP"] is None else round(p["CIscoreP"], 1),
            "diesel_pm_percentile": None if p["Diesel_PM_Pctl"] is None else round(p["Diesel_PM_Pctl"], 1),
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [[[[round(x, 5), round(y, 5)] for x, y in ring] for ring in polygon] for polygon in polygons],
            },
            "projected": projected,
            "boxes": [
                (
                    min(x for ring in polygon for x, _ in ring),
                    min(y for ring in polygon for _, y in ring),
                    max(x for ring in polygon for x, _ in ring),
                    max(y for ring in polygon for _, y in ring),
                )
                for polygon in projected
            ],
        }

    # Per segment first. A route's sets are the union of its segments' sets, which
    # is the same as buffering the whole route: a school beside two segments is
    # one id in the union, so it is counted once.
    by_segment = {}
    for sid, line in lines.items():
        near_schools = sorted(s["id"] for s in schools.values() if point_to_line(s["xy"], line) <= BUFFER_M)
        near_tracts = sorted(
            t["id"]
            for t in tracts.values()
            if any(line_to_polygon(line, rings, box_) <= BUFFER_M for rings, box_ in zip(t["projected"], t["boxes"]))
        )
        by_segment[sid] = {
            "schools": near_schools,
            "dac_tracts": near_tracts,
            "near_sensitive_zone": bool(near_schools or near_tracts),
        }

    by_route = {}
    for route in routes.values():
        school_ids = sorted({i for sid in route["segment_ids"] for i in by_segment[sid]["schools"]})
        tract_ids = sorted({i for sid in route["segment_ids"] for i in by_segment[sid]["dac_tracts"]})
        diesel = [tracts[i]["diesel_pm_percentile"] for i in tract_ids if tracts[i]["diesel_pm_percentile"] is not None]
        by_route[route["id"]] = {
            "schools_150m": len(school_ids),
            "schools": school_ids,
            "dac_tracts": tract_ids,
            "max_diesel_pm_pctl": max(diesel) if diesel else None,
            "near_sensitive_zone": bool(school_ids or tract_ids),
            "note": import_map_data.community_note(len(school_ids), len(tract_ids), BUFFER_M),
        }

    used_schools = sorted({i for r in by_route.values() for i in r["schools"]})
    used_tracts = sorted({i for r in by_route.values() for i in r["dac_tracts"]})
    retrieved = now.strftime("%Y-%m-%d")
    summary = {
        "label": "REAL locations, ILLUSTRATIVE routes",
        "buffer_m": BUFFER_M,
        "method": (
            f"A school counts when it lies within {BUFFER_M} m of the route's drawn line; a disadvantaged tract counts "
            f"when any part of it lies within {BUFFER_M} m. Distances are measured in metres in California Albers "
            "(EPSG:3310). Each route is measured as a whole, so nothing is counted twice."
        ),
        "meaning": (
            "Proximity to a drawn line, not measured exposure or health impact. The route lines are schematic, "
            "so they do not follow the road exactly and the counts are indicative."
        ),
        "basis": (
            "Kozawa, Fruin and Winer (2009), Near-road air pollution impacts of goods movement in communities "
            "adjacent to the Ports of Los Angeles and Long Beach, Atmospheric Environment 43."
        ),
        "geometry_fingerprint": import_map_data.fingerprint(list(segments.values())),
        "sources": [
            {
                "id": "schools",
                "name": "Public School Locations, Current",
                "publisher": "National Center for Education Statistics",
                "edition": ", ".join(school_years) or "current",
                "url": SCHOOLS_URL,
                "retrieved": retrieved,
                "features_in_study_box": len(school_features),
            },
            {
                "id": "dac_tracts",
                "name": "SB 535 Disadvantaged Communities 2022",
                "publisher": "California Office of Environmental Health Hazard Assessment (CalEPA)",
                "edition": "2022",
                "url": TRACTS_URL,
                "retrieved": retrieved,
                "features_in_study_box": len(tract_features),
            },
        ],
        "study_box": [round(v, 4) for v in box],
        "routes": by_route,
        "segments": by_segment,
    }
    # The places themselves, for the map only. Kept apart so the dashboard does
    # not load every tract outline just to show the counts.
    layers = {
        "label": "REAL",
        "note": "The schools and disadvantaged tracts counted in corridor.json. Sources and dates are listed there.",
        "schools": [{k: schools[i][k] for k in ("id", "name", "city", "lon", "lat")} for i in used_schools],
        "tracts": [
            {k: tracts[i][k] for k in ("id", "population", "ces_percentile", "diesel_pm_percentile", "geometry")}
            for i in used_tracts
        ],
    }
    return summary, layers


def dilemma(result, routes):
    """The brief's check: an alternative that passes sensitive places, and one that avoids them at a cost."""
    lines, passes, avoids = [], False, False
    by_destination = {}
    for route in routes.values():
        by_destination.setdefault(route["destination"], {})[route["kind"]] = route
    for destination, pair in sorted(by_destination.items()):
        original, alternative = pair["original"], pair["alternative"]
        o, a = result["routes"][original["id"]], result["routes"][alternative["id"]]
        lines.append(
            f"  {destination}: original {original['id']} {o['schools_150m']} schools, {len(o['dac_tracts'])} tracts, "
            f"{original['total_miles']} mi | alternative {alternative['id']} {a['schools_150m']} schools, "
            f"{len(a['dac_tracts'])} tracts, {alternative['total_miles']} mi"
        )
        passes = passes or a["near_sensitive_zone"]
        schools = (a["schools_150m"], o["schools_150m"])
        tracts = (len(a["dac_tracts"]), len(o["dac_tracts"]))
        fewer = schools[0] <= schools[1] and tracts[0] <= tracts[1] and (schools[0] < schools[1] or tracts[0] < tracts[1])
        avoids = avoids or (fewer and alternative["total_miles"] > original["total_miles"])
    return lines, passes, avoids


FILES = ("segments.json", "routes.json", "shipments.json", "sample-responses.json")


def main():
    check_only = "--check" in sys.argv
    files = {name: json.loads((OUT / name).read_text()) for name in FILES}
    segments = {s["id"]: s for s in files["segments.json"]["items"]}
    routes = {r["id"]: r for r in files["routes.json"]["items"]}
    result, layers = analyse(segments, routes, datetime.datetime.now(datetime.timezone.utc))

    lines, passes, avoids = dilemma(result, routes)
    print(f"Within {BUFFER_M} m of each route (real locations, illustrative routes):")
    print("\n".join(lines))
    print(f"An alternative passes schools or disadvantaged tracts: {'yes' if passes else 'NO'}")
    print(f"An alternative passes fewer schools and tracts than its original, over more miles: {'yes' if avoids else 'NO'}")
    if not (passes and avoids):
        print("The brief asks for both. If the real data does not give both, change which route is used, never the data.")

    if check_only:
        return
    import_map_data.apply_corridor(files, result)
    files["corridor.json"] = result
    for name, content in files.items():
        (OUT / name).write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n")
    # One line per place: the outlines are long and nobody reads them by eye.
    (OUT / "corridor-layers.json").write_text(json.dumps(layers, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Wrote corridor.json and corridor-layers.json; updated {', '.join(FILES[:2] + FILES[3:])} in {OUT}")


if __name__ == "__main__":
    main()
