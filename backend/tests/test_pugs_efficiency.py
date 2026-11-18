"""Offline regressions for complete, reusable and hole-aware PUGS screening."""
import asyncio
from unittest.mock import AsyncMock, patch
import httpx
import pytest
from app import pugs, pugs_batch, municipal_http


def polygon(west=-78.498, south=-0.199, east=-78.494, north=-0.195):
    return {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}


def parcel(ident="123", geometry=None):
    return {"type": "Feature", "geometry": geometry or polygon(), "properties": {
        "n_predio": ident, "tipo_propi": "PROPIEDAD HORIZONTAL", "area_terre": 1000, "area_ter_1": 50}}


def zone(ident=1, geometry=None):
    return {"type": "Feature", "id": ident, "geometry": geometry or polygon(),
            "properties": {"OBJECTID": ident, "unidad_viv": "VB"}}


@pytest.fixture(autouse=True)
def reset_tiles(monkeypatch):
    def unexpected(request):
        raise AssertionError("This test must not make a municipal network request")
    monkeypatch.setattr(municipal_http, "_new_client", lambda timeout=30.0:
                        httpx.AsyncClient(transport=httpx.MockTransport(unexpected), timeout=timeout))
    pugs_batch.CACHE.clear()
    yield
    pugs_batch.CACHE.clear()


@pytest.mark.parametrize("case,expected", [("hole", 75), ("multipolygon", 50), ("boundary", 0)])
def test_single_and_batch_geometry_semantics(monkeypatch, case, expected):
    parcel_geom, zone_geom = polygon(), polygon()
    if case == "hole":
        zone_geom["coordinates"].append(polygon(-78.497, -0.198, -78.495, -0.196)["coordinates"][0])
    elif case == "multipolygon":
        left = polygon(-78.498, -0.199, -78.497, -0.198)
        right = polygon(-78.495, -0.199, -78.494, -0.198)
        parcel_geom = {"type": "MultiPolygon", "coordinates": [left["coordinates"], right["coordinates"]]}
        zone_geom = left
    else:
        zone_geom = polygon(-78.494, -0.199, -78.490, -0.195)
    item, zoning = parcel(geometry=parcel_geom), zone(geometry=zone_geom)
    monkeypatch.setattr(pugs, "lookup_core_predio", AsyncMock(return_value={"type": "FeatureCollection", "features": [item]}))
    async def post(client, url, *, data, **kwargs):
        assert data["f"] == "geojson"
        return httpx.Response(200, json={"type": "FeatureCollection", "features": [zoning]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(pugs, "post", post)
    async def fetch(tile):
        return [zoning]
    async def scenario():
        single = await pugs.lookup_pugs("123", "n_predio")
        batch = (await pugs_batch.spatial_screen([item], fetch_tile=fetch))["results"][0]
        assert single["status"] == batch["status"]
        assert single["regulatory_approval"] is False
        assert single["cadastral"]["individual_area_m2"] == 50
        assert single["cadastral"]["parent_lot_area_m2"] == 1000
        if expected:
            assert single["zones"][0]["_overlap_percent"] == pytest.approx(expected, abs=0.01)
            assert single["zones"][0]["_overlap_percent"] == batch["zones"][0]["_overlap_percent"]
        else:
            assert single["status"] == "no_intersection" and single["zones"] == []
    asyncio.run(scenario())


@pytest.mark.parametrize("total,flag,expected_pages", [(250, "top", 1), (2000, "top", 8), (2000, "properties", 8), (2000, "absent", 9)])
def test_exact_pagination_boundaries(total, flag, expected_pages):
    calls = []
    class Client:
        async def post(self, url, *, data, **kwargs):
            offset, count = int(data["resultOffset"]), int(data["resultRecordCount"])
            calls.append((offset, count))
            stop = min(total, offset + count)
            payload = {"type": "FeatureCollection", "features": [zone(i) for i in range(offset, stop)]}
            if flag == "top":
                payload["exceededTransferLimit"] = stop < total
            elif flag == "properties":
                payload["properties"] = {"exceededTransferLimit": stop < total}
            return httpx.Response(200, json=payload, request=httpx.Request("POST", url))
    rows = asyncio.run(pugs_batch._fetch_tile(Client(), (-3140, -8)))
    assert len(rows) == total and len(calls) == expected_pages
    if flag == "absent":
        assert calls[-1] == (2000, 1)


@pytest.mark.parametrize("flag", ["absent", "true"])
def test_truncated_tile_at_cap_is_rejected(flag):
    class Client:
        async def post(self, url, *, data, **kwargs):
            offset, count = int(data["resultOffset"]), int(data["resultRecordCount"])
            payload = {"type": "FeatureCollection", "features": [zone(i) for i in range(offset, offset + count)]}
            if flag == "true":
                payload["exceededTransferLimit"] = True
            return httpx.Response(200, json=payload, request=httpx.Request("POST", url))
    with pytest.raises(ValueError, match="pagination limit"):
        asyncio.run(pugs_batch._fetch_tile(Client(), (-3140, -8)))


def test_repeated_page_is_rejected():
    class Client:
        async def post(self, url, *, data, **kwargs):
            payload = {"type": "FeatureCollection", "features": [zone(i) for i in range(250)], "exceededTransferLimit": True}
            return httpx.Response(200, json=payload, request=httpx.Request("POST", url))
    with pytest.raises(ValueError, match="repeated a zone"):
        asyncio.run(pugs_batch._fetch_tile(Client(), (-3140, -8)))


def test_short_pages_with_more_results_do_not_skip_zones():
    offsets = []
    class Client:
        async def post(self, url, *, data, **kwargs):
            offset = int(data["resultOffset"])
            offsets.append(offset)
            stop = min(300, offset + 75)
            payload = {"type": "FeatureCollection", "features": [zone(i) for i in range(offset, stop)],
                       "exceededTransferLimit": stop < 300}
            return httpx.Response(200, json=payload, request=httpx.Request("POST", url))
    rows = asyncio.run(pugs_batch._fetch_tile(Client(), (-3140, -8)))
    assert offsets == [0, 75, 150, 225]
    assert [row["id"] for row in rows] == list(range(300))


def test_short_page_requests_have_a_finite_budget(monkeypatch):
    monkeypatch.setattr(pugs_batch, "MAX_TILE_PAGE_REQUESTS", 3)
    calls = []
    class Client:
        async def post(self, url, *, data, **kwargs):
            offset = int(data["resultOffset"])
            calls.append(offset)
            payload = {"type": "FeatureCollection", "features": [zone(offset)], "exceededTransferLimit": True}
            return httpx.Response(200, json=payload, request=httpx.Request("POST", url))
    with pytest.raises(ValueError, match="request budget"):
        asyncio.run(pugs_batch._fetch_tile(Client(), (-3140, -8)))
    assert calls == [0, 1, 2]


def test_warm_tile_reuses_index_and_source_changes_reload(monkeypatch):
    calls = []
    async def fetch(tile):
        calls.append(tile)
        return [zone()]
    async def scenario():
        with patch.object(pugs_batch, "_prepare_tile", wraps=pugs_batch._prepare_tile) as prepare:
            first = await pugs_batch.spatial_screen([parcel()], fetch_tile=fetch)
            second = await pugs_batch.spatial_screen([parcel()], fetch_tile=fetch)
            assert first["results"] == second["results"]
            assert prepare.call_count == 1 and len(calls) == 1
            assert second["cache_hits"] == 1 and second["tile_requests"] == 0
            monkeypatch.setattr(pugs_batch, "LAYER", "https://municipal.example/new-pugs")
            await pugs_batch.spatial_screen([parcel()], fetch_tile=fetch)
            assert prepare.call_count == 2 and len(calls) == 2
    asyncio.run(scenario())


def test_concurrent_cold_requests_share_tile_despite_cancellation():
    calls = 0
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()
        async def fetch(tile):
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return [zone()]
        first = asyncio.create_task(pugs_batch.spatial_screen([parcel()], fetch_tile=fetch))
        await started.wait()
        second = asyncio.create_task(pugs_batch.spatial_screen([parcel()], fetch_tile=fetch))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        result = await second
        assert calls == 1 and result["results"][0]["status"] == "single_zone"
        assert result["shared_tile_requests"] == 1 and len(pugs_batch.CACHE) == 1
        assert not pugs_batch.CACHE.inflight
    asyncio.run(scenario())


def test_tile_limit_is_shared_between_batches():
    async def scenario():
        active = peak = 0
        four_started, release = asyncio.Event(), asyncio.Event()
        async def fetch(tile):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            if active == 4:
                four_started.set()
            try:
                await release.wait()
                return []
            finally:
                active -= 1
        batches = [[parcel(str(i), polygon(-78.498 + i * 0.05, -0.199, -78.497 + i * 0.05, -0.198))
                    for i in indices] for indices in (range(4), range(4, 8))]
        tasks = [asyncio.create_task(pugs_batch.spatial_screen(items, fetch_tile=fetch)) for items in batches]
        await asyncio.wait_for(four_started.wait(), 1)
        await asyncio.sleep(0)
        assert peak == 4
        release.set()
        results = await asyncio.gather(*tasks)
        assert peak == 4 and sum(result["tile_requests"] for result in results) == 8
    asyncio.run(scenario())


def test_invalid_zone_makes_tile_unavailable_and_is_not_cached():
    calls = 0
    async def fetch(tile):
        nonlocal calls
        calls += 1
        if calls == 1:
            broken = zone(2)
            broken["geometry"] = {"type": "Polygon", "coordinates": []}
            return [zone(), broken]
        return [zone()]
    async def scenario():
        first = await pugs_batch.spatial_screen([parcel()], fetch_tile=fetch)
        assert first["results"][0]["status"] == "unavailable" and len(pugs_batch.CACHE) == 0
        second = await pugs_batch.spatial_screen([parcel()], fetch_tile=fetch)
        assert second["results"][0]["status"] == "single_zone" and calls == 2
    asyncio.run(scenario())


def test_invalid_single_zone_is_unavailable(monkeypatch):
    monkeypatch.setattr(pugs, "lookup_core_predio", AsyncMock(return_value={"features": [parcel()]}))
    broken = zone()
    broken["geometry"] = {"type": "Polygon", "coordinates": []}
    async def post(client, url, **kwargs):
        return httpx.Response(200, json={"type": "FeatureCollection", "features": [broken]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(pugs, "post", post)
    result = asyncio.run(pugs.lookup_pugs("123", "n_predio"))
    assert result["status"] == "unavailable" and result["zones"] == []
