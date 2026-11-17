"""Offline tests of tiled PUGS spatial joins (no municipal HTTP calls)."""
import asyncio

from app.pugs_batch import CACHE, TILE_SIZE, spatial_screen


def polygon(west, south, east, north):
    return {
        "type": "Polygon",
        "coordinates": [[
            [west, south], [east, south], [east, north],
            [west, north], [west, south],
        ]],
    }


def parcel(ident, west, south, east, north):
    return {
        "type": "Feature",
        "properties": {"n_predio": ident},
        "geometry": polygon(west, south, east, north),
    }


def zone(west, south, east, north, zone_id=42):
    return {
        "type": "Feature",
        "id": zone_id,
        "properties": {
            "OBJECTID": zone_id,
            "unidad_viv": "VB",
            "cod_clasif": "SU",
        },
        "geometry": polygon(west, south, east, north),
    }


def test_reuses_one_zone_tile_for_neighboring_parcels():
    CACHE.clear()
    requested = []

    async def fetch(tile):
        requested.append(tile)
        return [zone(-78.499, -0.201, -78.492, -0.192)]

    parcels = [
        parcel("100", -78.498, -0.199, -78.497, -0.198),
        parcel("101", -78.496, -0.197, -78.495, -0.196),
    ]
    result = asyncio.run(spatial_screen(parcels, fetch_tile=fetch))
    assert result["screened"] == 2
    assert result["tile_requests"] == 1
    assert len(requested) == 1
    assert result["zone_features_indexed"] == 1
    assert [item["status"] for item in result["results"]] == ["single_zone", "single_zone"]
    assert all(item["zones"][0]["unidad_viv"] == "VB" for item in result["results"])
    assert all(item["zones"][0]["_overlap_percent"] >= 99 for item in result["results"])

    again = asyncio.run(spatial_screen(parcels, fetch_tile=fetch))
    assert again["tile_requests"] == 0
    assert again["cache_hits"] == 1


def test_one_parcel_can_intersect_two_zones():
    CACHE.clear()

    async def fetch(tile):
        return [
            zone(-78.499, -0.205, -78.497, -0.190, 1),
            zone(-78.497, -0.205, -78.494, -0.190, 2),
        ]

    p = parcel("102", -78.498, -0.198, -78.496, -0.196)
    result = asyncio.run(spatial_screen([p], fetch_tile=fetch))
    item = result["results"][0]
    assert item["status"] == "multiple_zones"
    assert len(item["zones"]) == 2
    assert abs(sum(z["_overlap_percent"] for z in item["zones"]) - 100) < 0.1


def test_failed_tile_is_not_falsely_reported_as_no_intersection():
    CACHE.clear()

    async def fetch(tile):
        raise ValueError("municipal service offline")

    p = parcel("103", -78.498, -0.198, -78.497, -0.197)
    result = asyncio.run(spatial_screen([p], fetch_tile=fetch))
    assert result["tile_failures"] == 1
    assert result["results"][0]["status"] == "unavailable"


def test_invalid_parcel_is_reported_not_dropped():
    CACHE.clear()

    async def fetch(tile):
        return []

    invalid = parcel("104", -78.499, -0.20, -78.499, -0.20)
    result = asyncio.run(spatial_screen([invalid], fetch_tile=fetch))
    assert result["screened"] == 1
    assert result["results"][0]["status"] == "unavailable"


def test_cross_tile_parcel_deduplicates_same_zone():
    CACHE.clear()
    requested = []

    async def fetch(tile):
        requested.append(tile)
        return [zone(-78.506, -0.207, -78.493, -0.193, 77)]

    p = parcel("105", -78.501, -0.201, -78.499, -0.199)
    result = asyncio.run(spatial_screen([p], fetch_tile=fetch))
    assert len(requested) > 1
    assert result["zone_features_indexed"] == 1
    assert result["results"][0]["status"] == "single_zone"


def test_polygon_hole_excludes_empty_interior():
    CACHE.clear()

    async def fetch(tile):
        return [zone(-78.5, -0.205, -78.49, -0.19, 9)]

    outer = polygon(-78.498, -0.199, -78.494, -0.195)["coordinates"][0]
    inner = polygon(-78.497, -0.198, -78.495, -0.196)["coordinates"][0]
    p = {"type": "Feature", "properties": {"n_predio": "106"},
         "geometry": {"type": "Polygon", "coordinates": [outer, inner]}}
    result = asyncio.run(spatial_screen([p], fetch_tile=fetch))
    assert result["results"][0]["status"] == "single_zone"
    assert 99.0 <= result["results"][0]["zones"][0]["_overlap_percent"] <= 100.0
