"""Spatially indexed PUGS enrichment of a supplied cadastral GIS page.

No property-by-property municipal lookups. Municipal PUGS polygons are queried
once per fixed geographic tile, cached briefly, then joined to the supplied
GeoJSON parcel shapes with Shapely STRtree in projected metres.

This is screening evidence, not regulatory approval or IRM interpretation.
"""
from __future__ import annotations

import asyncio
import math
import time
from collections import OrderedDict
from typing import Any

import httpx
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import shape
from shapely.ops import transform

from .pugs import LAYER

TILE_SIZE = 0.025  # degrees; fixed tile keys make cross-request cache safe
MAX_PARCELS = 100
MAX_VERTICES = 40000
MAX_TILES = 90
PAGE_SIZE = 250
MAX_ZONE_ROWS_PER_TILE = 2000
MAX_ZONES_PER_PARCEL = 30
CACHE_SECONDS = 900
MAX_CACHED_TILES = 150
CACHE: OrderedDict[tuple[int, int], tuple[float, list[dict[str, Any]]]] = OrderedDict()
PROJECTION = Transformer.from_crs("EPSG:4326", "EPSG:32717", always_xy=True)

# Confirmed published attribute fields are returned without presuming codes.
ZONE_FIELDS = (
    "OBJECTID,fcode,leyenda,tipo_des,cod_edi_es,unidad_viv,"
    "edifi_ba,edifi_gm,ocupa_ba,ocupa_gm,"
    "cod_ocu_ba,cod_ocu_gm,cod_clasif,clasifica,"
    "pisos_ba,lot_min_ba,cos_pb_ba,pisos_gm,lot_min_gm,cos_pb_gm"
)


def _vertices(coordinates: Any) -> int:
    if not isinstance(coordinates, (tuple, list)):
        return 0
    if len(coordinates) >= 2 and isinstance(coordinates[0], (int, float)):
        return 1
    return sum(_vertices(part) for part in coordinates)


def _valid_shape(feature: dict[str, Any]):
    geom = feature.get("geometry") or {}
    if geom.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("Only Polygon/MultiPolygon parcel geometries are accepted")
    polygon = shape(geom)
    if polygon.is_empty:
        raise ValueError("Empty cadastral polygon")
    bounds = polygon.bounds
    if not all(math.isfinite(v) for v in bounds):
        raise ValueError("Nonfinite cadastral coordinates")
    # Quito municipality: basic guard against incompatible CRS/units.
    if bounds[0] < -80 or bounds[2] > -77 or bounds[1] < -2 or bounds[3] > 1:
        raise ValueError("Parcel outside expected Quito WGS84 bounds")
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or polygon.area <= 0:
        raise ValueError("Invalid cadastral polygon")
    return polygon


def _tiles_for_bounds(bounds):
    west, south, east, north = bounds
    # Include edge-adjacent tiles; boundary-only overlaps are later discarded.
    x0, x1 = math.floor(west / TILE_SIZE), math.floor(east / TILE_SIZE)
    y0, y1 = math.floor(south / TILE_SIZE), math.floor(north / TILE_SIZE)
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def _get_cached(tile):
    saved = CACHE.get(tile)
    if saved is None:
        return None
    stamp, rows = saved
    if time.monotonic() - stamp > CACHE_SECONDS:
        CACHE.pop(tile, None)
        return None
    CACHE.move_to_end(tile)
    return rows


def _store_cached(tile, rows):
    CACHE[tile] = (time.monotonic(), rows)
    CACHE.move_to_end(tile)
    while len(CACHE) > MAX_CACHED_TILES:
        CACHE.popitem(last=False)


async def _fetch_tile(client: httpx.AsyncClient, tile: tuple[int, int]):
    """Retrieve all zone polygons in a fixed tile; reject truncated results."""
    x, y = tile
    envelope = {
        "xmin": x * TILE_SIZE, "ymin": y * TILE_SIZE,
        "xmax": (x + 1) * TILE_SIZE, "ymax": (y + 1) * TILE_SIZE,
        "spatialReference": {"wkid": 4326},
    }
    import json
    rows = []
    for offset in range(0, MAX_ZONE_ROWS_PER_TILE, PAGE_SIZE):
        params = {
            "where": "1=1",
            "geometry": json.dumps(envelope),
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": ZONE_FIELDS,
            "orderByFields": "OBJECTID ASC",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE_SIZE),
        }
        response = await client.post(LAYER + "/query", data=params)
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise ValueError("PUGS ArcGIS error: " + str(payload["error"].get("message", "unknown")))
        if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
            raise ValueError("PUGS returned invalid GeoJSON")
        batch = payload["features"]
        rows.extend(batch)
        if len(batch) < PAGE_SIZE and not payload.get("exceededTransferLimit"):
            return rows
    # Do not silently classify against an incomplete zoning layer.
    raise ValueError("PUGS tile result exceeded the configured pagination limit")


async def spatial_screen(features: list[dict[str, Any]], *, fetch_tile=None):
    """Join up to 100 supplied parcel features against cached PUGS tiles.

    fetch_tile may be injected in tests; production uses ArcGIS HTTP requests.
    Every parcel receives a status, even on partial upstream failures.
    """
    if not 1 <= len(features) <= MAX_PARCELS:
        raise ValueError("Provide 1 to 100 cadastral features")
    if sum(_vertices((f.get("geometry") or {}).get("coordinates")) for f in features) > MAX_VERTICES:
        raise ValueError("Too many parcel vertices in one request")

    parcels = {}
    errors = {}
    needed = {}
    for feature in features:
        ident = str((feature.get("properties") or {}).get("n_predio") or "").strip()
        if not ident.isdigit() or len(ident) > 25:
            raise ValueError("Every cadastral feature needs a valid n_predio")
        if ident in parcels or ident in errors:
            raise ValueError("Duplicate n_predio in spatial batch")
        try:
            polygon = _valid_shape(feature)
            tiles = _tiles_for_bounds(polygon.bounds)
            if len(tiles) > MAX_TILES:
                raise ValueError("Parcel extent exceeds supported tiled screening area")
            parcels[ident] = polygon
            needed[ident] = tiles
        except (ValueError, TypeError) as exc:
            errors[ident] = str(exc)

    tile_keys = set().union(*needed.values()) if needed else set()
    if len(tile_keys) > MAX_TILES:
        raise ValueError(
            "The selected properties span too many spatial tiles; narrow the GIS page/area"
        )

    fetched, cache_hits, tile_errors, requests = {}, 0, {}, 0
    to_load = []
    for tile in sorted(tile_keys):
        cached = _get_cached(tile)
        if cached is not None:
            fetched[tile] = cached
            cache_hits += 1
        else:
            to_load.append(tile)

    async def load_tiles(http_client):
        nonlocal requests
        sem = asyncio.Semaphore(4)

        async def load(tile):
            nonlocal requests
            async with sem:
                requests += 1
                try:
                    if fetch_tile is None:
                        rows = await _fetch_tile(http_client, tile)
                    else:
                        rows = await fetch_tile(tile)
                    fetched[tile] = rows
                    _store_cached(tile, rows)
                except (httpx.HTTPError, ValueError, TypeError) as exc:
                    tile_errors[tile] = str(exc)

        await asyncio.gather(*(load(tile) for tile in to_load))

    if to_load:
        if fetch_tile is None:
            async with httpx.AsyncClient(timeout=35.0, follow_redirects=False) as client:
                await load_tiles(client)
        else:
            await load_tiles(None)

    # Tile boundaries overlap zoning polygons. Deduplicate by official OBJECTID
    # before indexing, then compare in square metres rather than degrees.
    unique = {}
    for rows in fetched.values():
        for feature in rows:
            properties = feature.get("properties") or {}
            zone_id = properties.get("OBJECTID") or feature.get("id")
            if zone_id is None:
                continue
            unique[str(zone_id)] = feature

    zone_polygons, zone_attrs = [], []
    for feature in unique.values():
        try:
            geom = _valid_shape(feature)
            projected = transform(PROJECTION.transform, geom)
            if projected.is_empty or projected.area <= 0:
                continue
            zone_polygons.append(projected)
            zone_attrs.append(feature.get("properties") or {})
        except (ValueError, TypeError):
            continue

    index = STRtree(zone_polygons) if zone_polygons else None
    results = []
    for feature in features:
        ident = str((feature.get("properties") or {}).get("n_predio"))
        if ident in errors:
            results.append({"predio": ident, "status": "unavailable", "zones": [], "error": errors[ident]})
            continue
        if any(tile in tile_errors for tile in needed[ident]):
            results.append({
                "predio": ident, "status": "unavailable", "zones": [],
                "error": "One or more spatial tiles were unavailable or truncated",
            })
            continue
        parcel = transform(PROJECTION.transform, parcels[ident])
        if parcel.is_empty or parcel.area <= 0:
            results.append({"predio": ident, "status": "unavailable", "zones": [],
                            "error": "Projected cadastral geometry invalid"})
            continue
        matches = []
        if index is not None:
            for index_id in index.query(parcel):
                i = int(index_id)
                zone = zone_polygons[i]
                if not parcel.intersects(zone):
                    continue
                overlap = parcel.intersection(zone).area
                if overlap <= 0:
                    continue
                attributes = dict(zone_attrs[i])
                attributes["_overlap_m2"] = round(overlap, 2)
                attributes["_overlap_percent"] = round(overlap / parcel.area * 100, 2)
                matches.append(attributes)
        matches.sort(key=lambda item: item["_overlap_m2"], reverse=True)
        if len(matches) > MAX_ZONES_PER_PARCEL:
            results.append({"predio": ident, "status": "ambiguous", "zones": [],
                            "error": "Too many intersecting PUGS polygons for a reliable summary"})
            continue
        results.append({
            "predio": ident,
            "status": "single_zone" if len(matches) == 1 else "multiple_zones" if matches else "no_intersection",
            "zones": matches,
        })

    return {
        "results": results,
        "screened": len(features),
        "zone_features_indexed": len(zone_polygons),
        "spatial_tiles": len(tile_keys),
        "cache_hits": cache_hits,
        "tile_requests": requests,
        "tile_failures": len(tile_errors),
        "spatial_method": "fixed WGS84 tiles + EPSG:32717 overlay + Shapely STRtree",
        "scope": "supplied_predios_only",
        "source": LAYER,
        "regulatory_approval": False,
    }
