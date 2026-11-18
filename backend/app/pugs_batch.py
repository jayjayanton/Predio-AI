"""Bounded PUGS screening with reusable, prepared spatial tiles.

Parcel geometry is supplied by the explorer. Complete municipal zoning tiles
are cached with their projected geometry and STRtree; simultaneous callers
share a missing tile load. Evidence remains preliminary, never approval.
"""
from __future__ import annotations

import asyncio
import json
import math
from dataclasses import dataclass
from typing import Any
from weakref import WeakKeyDictionary, ref

import httpx
from shapely import STRtree
from shapely.errors import GEOSException

from .async_cache import AsyncTTLCache
from .municipal_http import municipal_client, post
from .pugs import LAYER
from .spatial_geometry import valid_polygon, project_polygon, overlap_attributes, transfer_limit

TILE_SIZE = 0.025
MAX_PARCELS = 100
MAX_VERTICES = 40000
MAX_TILES = 90
PAGE_SIZE = 250
MAX_ZONE_ROWS_PER_TILE = 2000
MAX_TILE_PAGE_REQUESTS = 32
MAX_ZONES_PER_PARCEL = 30
CACHE_SECONDS = 900
MAX_CACHED_TILES = 150
MAX_CONCURRENT_TILES = 4
_tile_limits: WeakKeyDictionary = WeakKeyDictionary()

ZONE_FIELDS = (
    "OBJECTID,fcode,leyenda,tipo_des,cod_edi_es,unidad_viv,"
    "edifi_ba,edifi_gm,ocupa_ba,ocupa_gm,"
    "cod_ocu_ba,cod_ocu_gm,cod_clasif,clasifica,"
    "pisos_ba,lot_min_ba,cos_pb_ba,pisos_gm,lot_min_gm,cos_pb_gm"
)


@dataclass(frozen=True)
class PreparedTile:
    ids: tuple
    polygons: tuple
    attributes: tuple
    index: Any
    weight: int


CACHE = AsyncTTLCache(
    ttl=CACHE_SECONDS, max_entries=MAX_CACHED_TILES, max_weight=32 * 1024 * 1024,
    weight=lambda tile: tile.weight,
)


def _tile_limit():
    loop = asyncio.get_running_loop()
    saved = _tile_limits.get(loop)
    limit = saved() if saved is not None else None
    if limit is None:
        limit = asyncio.Semaphore(MAX_CONCURRENT_TILES)
        _tile_limits[loop] = ref(limit)
    return limit


async def close_cache():
    await CACHE.close()
    _tile_limits.pop(asyncio.get_running_loop(), None)


def _vertices(coordinates: Any) -> int:
    if not isinstance(coordinates, (tuple, list)):
        return 0
    if len(coordinates) >= 2 and isinstance(coordinates[0], (int, float)):
        return 1
    return sum(_vertices(part) for part in coordinates)


def _valid_shape(feature):
    return valid_polygon(feature.get("geometry"))


def _tiles_for_bounds(bounds):
    west, south, east, north = bounds
    x0, x1 = math.floor(west / TILE_SIZE), math.floor(east / TILE_SIZE)
    y0, y1 = math.floor(south / TILE_SIZE), math.floor(north / TILE_SIZE)
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def _zone_id(feature):
    if not isinstance(feature, dict):
        raise ValueError("PUGS returned an invalid zone feature")
    properties = feature.get("properties") or {}
    if not isinstance(properties, dict):
        raise ValueError("PUGS zone attributes are invalid")
    value = properties.get("OBJECTID")
    if value is None:
        value = feature.get("id")
    if value is None:
        raise ValueError("PUGS zone is missing its official identifier")
    return str(value)


def _prepare_tile(rows):
    ids, polygons, attributes = [], [], []
    seen = set()
    weight = 256
    for feature in rows:
        ident = _zone_id(feature)
        if ident in seen:
            continue
        seen.add(ident)
        polygon = project_polygon(_valid_shape(feature))
        props = dict(feature.get("properties") or {})
        ids.append(ident)
        polygons.append(polygon)
        attributes.append(props)
        # WKB plus an allowance for the geometry/index and attribute objects.
        # Count and weight bounds both apply; oversized tiles are not retained.
        weight += 3 * len(polygon.wkb) + 4 * len(json.dumps(props).encode("utf-8")) + 512
    return PreparedTile(tuple(ids), tuple(polygons), tuple(attributes),
                        STRtree(polygons) if polygons else None, weight)


async def _fetch_tile(client: httpx.AsyncClient, tile: tuple[int, int]):
    """Retrieve a complete fixed tile, including exact page/cap boundaries."""
    x, y = tile
    envelope = {
        "xmin": x * TILE_SIZE, "ymin": y * TILE_SIZE,
        "xmax": (x + 1) * TILE_SIZE, "ymax": (y + 1) * TILE_SIZE,
        "spatialReference": {"wkid": 4326},
    }

    async def page(offset, count):
        params = {
            "where": "1=1", "geometry": json.dumps(envelope),
            "geometryType": "esriGeometryEnvelope", "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects", "outFields": ZONE_FIELDS,
            "orderByFields": "OBJECTID ASC", "returnGeometry": "true",
            "outSR": "4326", "f": "geojson", "resultOffset": str(offset),
            "resultRecordCount": str(count),
        }
        response = await post(client, LAYER + "/query", data=params, timeout=35.0)
        response.raise_for_status()
        payload = response.json()
        if (not isinstance(payload, dict) or payload.get("error")
                or payload.get("type") != "FeatureCollection"
                or not isinstance(payload.get("features"), list)):
            raise ValueError("PUGS returned an error or invalid GeoJSON")
        batch = payload["features"]
        if len(batch) > count:
            raise ValueError("PUGS did not respect the requested page size")
        return batch, transfer_limit(payload)

    rows, seen = [], set()
    offset = pages = 0
    while offset < MAX_ZONE_ROWS_PER_TILE and pages < MAX_TILE_PAGE_REQUESTS:
        count = min(PAGE_SIZE, MAX_ZONE_ROWS_PER_TILE - offset)
        batch, limited = await page(offset, count)
        pages += 1
        for feature in batch:
            ident = _zone_id(feature)
            if ident in seen:
                raise ValueError("PUGS pagination repeated a zone; completeness is uncertain")
            seen.add(ident)
        rows.extend(batch)
        if limited is False or (len(batch) < count and limited is not True):
            return rows
        if not batch:
            raise ValueError("PUGS pagination made no progress")
        # A spatial query can return fewer records than requested while still
        # declaring more results. Advance by delivered records, not page size.
        offset += len(batch)

    if offset < MAX_ZONE_ROWS_PER_TILE:
        raise ValueError("PUGS tile pagination exceeded the bounded request budget")
    if limited is None:
        # GeoJSON sometimes omits the flag. One bounded probe distinguishes a
        # complete exact-cap tile from a larger, incomplete result.
        extra, more = await page(MAX_ZONE_ROWS_PER_TILE, 1)
        if not extra and more is not True:
            return rows
    raise ValueError("PUGS tile result exceeded the configured pagination limit")


async def spatial_screen(features: list[dict[str, Any]], *, fetch_tile=None):
    """Screen at most 100 supplied parcels; failures never imply eligibility."""
    if not 1 <= len(features) <= MAX_PARCELS:
        raise ValueError("Provide 1 to 100 cadastral features")
    if sum(_vertices((f.get("geometry") or {}).get("coordinates")) for f in features) > MAX_VERTICES:
        raise ValueError("Too many parcel vertices in one request")

    parcels, errors, needed = {}, {}, {}
    identifiers = []
    for feature in features:
        ident = str((feature.get("properties") or {}).get("n_predio") or "").strip()
        if not ident.isdigit() or len(ident) > 25:
            raise ValueError("Every cadastral feature needs a valid n_predio")
        if ident in parcels or ident in errors:
            raise ValueError("Duplicate n_predio in spatial batch")
        identifiers.append(ident)
        try:
            polygon = _valid_shape(feature)
            tiles = _tiles_for_bounds(polygon.bounds)
            if len(tiles) > MAX_TILES:
                raise ValueError("Parcel extent exceeds supported tiled screening area")
            parcels[ident] = project_polygon(polygon)
            needed[ident] = tiles
        except (ValueError, TypeError) as exc:
            errors[ident] = str(exc)

    tile_keys = set().union(*needed.values()) if needed else set()
    if len(tile_keys) > MAX_TILES:
        raise ValueError("The selected properties span too many spatial tiles; narrow the GIS page/area")

    fetched, tile_errors = {}, {}
    cache_hits = requests = shared = 0

    async def load(tile):
        nonlocal requests, cache_hits, shared

        async def fetch_and_prepare():
            nonlocal requests
            requests += 1
            async with _tile_limit():
                if fetch_tile is None:
                    async with municipal_client(35.0) as client:
                        rows = await _fetch_tile(client, tile)
                else:
                    rows = await fetch_tile(tile)
                # Prepare only complete, valid tiles. A malformed zone must not
                # disappear and create a false no-intersection result.
                return _prepare_tile(rows)

        try:
            key = (LAYER, TILE_SIZE, ZONE_FIELDS, tile)
            prepared, state = await CACHE.load(key, fetch_and_prepare)
            fetched[tile] = prepared
            cache_hits += state == "hit"
            shared += state == "shared"
        except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError) as exc:
            tile_errors[tile] = str(exc)

    await asyncio.gather(*(load(tile) for tile in sorted(tile_keys)))

    results = []
    for ident in identifiers:
        if ident in errors or any(tile in tile_errors for tile in needed[ident]):
            results.append({"predio": ident, "status": "unavailable", "zones": [],
                            "error": errors.get(ident, "One or more spatial tiles were unavailable or truncated")})
            continue
        parcel = parcels[ident]
        candidates = {}
        try:
            for tile in sorted(needed[ident]):
                prepared = fetched[tile]
                if prepared.index is not None:
                    for index_id in prepared.index.query(parcel):
                        i = int(index_id)
                        candidates[prepared.ids[i]] = (prepared.polygons[i], prepared.attributes[i])
            matches = []
            for polygon, attributes in candidates.values():
                match = overlap_attributes(parcel, polygon, attributes)
                if match is not None:
                    matches.append(match)
        except (ValueError, GEOSException):
            results.append({"predio": ident, "status": "unavailable", "zones": [],
                            "error": "Polygon intersections could not be evaluated completely"})
            continue
        matches.sort(key=lambda item: item["_overlap_m2"], reverse=True)
        if len(matches) > MAX_ZONES_PER_PARCEL:
            results.append({"predio": ident, "status": "ambiguous", "zones": [],
                            "error": "Too many intersecting PUGS polygons for a reliable summary"})
            continue
        results.append({"predio": ident,
                        "status": "single_zone" if len(matches) == 1 else "multiple_zones" if matches else "no_intersection",
                        "zones": matches})

    return {
        "results": results, "screened": len(features),
        "zone_features_indexed": len({ident for tile in fetched.values() for ident in tile.ids}),
        "spatial_tiles": len(tile_keys), "cache_hits": cache_hits,
        "tile_requests": requests, "shared_tile_requests": shared,
        "tile_failures": len(tile_errors),
        "spatial_method": "fixed WGS84 tiles + EPSG:32717 overlay + cached Shapely STRtree",
        "scope": "supplied_predios_only", "source": LAYER, "regulatory_approval": False,
    }
