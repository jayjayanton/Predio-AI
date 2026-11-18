"""Offline regressions for source reuse, connection pooling and safe shutdown."""
import asyncio
from copy import deepcopy

import httpx
import pytest

from app import main, municipal, municipal_http, pugs, pugs_batch
from app.async_cache import AsyncTTLCache


def geometry():
    return {"type": "Polygon", "coordinates": [[
        [-78.498, -0.199], [-78.497, -0.199], [-78.497, -0.198],
        [-78.498, -0.198], [-78.498, -0.199],
    ]]}


def feature():
    return {"type": "Feature", "geometry": geometry(), "properties": {
        "n_predio": "627739", "codigo_aiv": "example", "area_terre": 1000,
        "area_ter_1": 50, "tipo_propi": "PROPIEDAD HORIZONTAL", "avaluo_tot": 12345,
    }}


@pytest.fixture(autouse=True)
def clear_completed_caches():
    municipal.CORE_CACHE.clear()
    pugs_batch.CACHE.clear()
    yield
    municipal.CORE_CACHE.clear()
    pugs_batch.CACHE.clear()


def install_transport(monkeypatch, handler):
    clients = []

    def create(timeout=30.0):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=timeout)
        clients.append(client)
        return client

    monkeypatch.setattr(municipal_http, "_new_client", create)
    return clients


def test_property_then_pugs_reuses_core_and_one_http_pool(monkeypatch):
    calls = []

    def respond(request):
        calls.append(request)
        url = str(request.url)
        if "predios_a_2024" in url:
            body = {"type": "FeatureCollection", "features": [feature()]}
        elif "predios_2026_feb" in url:
            assert request.url.params["outFields"] == "predio,SHAPE__Area"
            body = {"type": "FeatureCollection", "features": [{
                "type": "Feature", "geometry": geometry(),
                "properties": {"predio": 627739, "SHAPE__Area": 1000},
            }]}
        elif "valoracion_del_suelo" in url:
            current = "/0/query" in url
            expected = "cod_aiva,valor_m2" if current else "CODIGO,VALOR"
            assert request.url.params["outFields"] == expected
            attrs = {"cod_aiva": "example", "valor_m2": 200} if current else {"CODIGO": "example", "VALOR": 190}
            body = {"features": [{"attributes": attrs}]}
        else:
            assert "plan_de_uso_y_gestion_del_suelo" in url
            body = {"type": "FeatureCollection", "features": [{
                "type": "Feature", "geometry": geometry(), "properties": {"OBJECTID": 1},
            }]}
        return httpx.Response(200, json=body)

    clients = install_transport(monkeypatch, respond)

    async def scenario():
        async with main.lifespan(main.app):
            data = await municipal.lookup_predio("627739", "n_predio")
            assert len(calls) == 4
            assert data["features"][0]["properties"]["_predioai_aiva_2026_usd_m2"] == 200
            assert data["features"][0]["properties"]["_predioai_geometry_source"] == "predios_2026_feb"
            result = await pugs.lookup_pugs("627739", "n_predio")
            assert len(calls) == 5  # Previously 9: core and AIVA were repeated.
            assert result["cadastral"]["individual_area_m2"] == 50
            assert result["cadastral"]["parent_lot_area_m2"] == 1000
            assert result["cadastral"]["is_horizontal_property"] is True
            assert result["regulatory_approval"] is False
            assert len(clients) == 1 and not clients[0].is_closed
        assert clients[0].is_closed
        assert not municipal.CORE_CACHE.inflight
        assert len(municipal.CORE_CACHE) == 0

    asyncio.run(scenario())


def test_core_cache_is_source_keyed_expires_and_isolates_mutations(monkeypatch):
    calls = []

    async def fetch(identifier, kind):
        calls.append((municipal.QUERY_URL, municipal.NEW_2026_LAYER_URL, kind, identifier))
        return {"type": "FeatureCollection", "features": [feature()]}

    monkeypatch.setattr(municipal, "_fetch_core_predio", fetch)

    async def scenario():
        first = await municipal.lookup_core_predio("627739", "n_predio")
        original = deepcopy(first)
        first["features"][0]["geometry"]["coordinates"][0][0][0] = 0
        first["features"][0]["properties"]["avaluo_tot"] = 0
        assert await municipal.lookup_core_predio("627739", "n_predio") == original
        assert len(calls) == 1
        monkeypatch.setattr(municipal, "QUERY_URL", "https://municipal.example/new/query")
        await municipal.lookup_core_predio("627739", "n_predio")
        assert len(calls) == 2
        monkeypatch.setattr(municipal, "NEW_2026_LAYER_URL", "https://municipal.example/new-geometry")
        await municipal.lookup_core_predio("627739", "n_predio")
        assert len(calls) == 3
        monkeypatch.setattr(municipal.CORE_CACHE, "ttl", 0)
        await municipal.lookup_core_predio("627739", "n_predio")
        assert len(calls) == 4

    asyncio.run(scenario())


def test_core_concurrent_requests_share_load_despite_one_cancellation(monkeypatch):
    calls = 0

    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        async def fetch(identifier, kind):
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return {"type": "FeatureCollection", "features": [feature()]}

        monkeypatch.setattr(municipal, "_fetch_core_predio", fetch)
        first = asyncio.create_task(municipal.lookup_core_predio("627739", "n_predio"))
        await started.wait()
        second = asyncio.create_task(municipal.lookup_core_predio("627739", "n_predio"))
        await asyncio.sleep(0)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        assert (await second)["features"][0]["properties"]["n_predio"] == "627739"
        assert calls == 1
        assert not municipal.CORE_CACHE.inflight

    asyncio.run(scenario())


def test_core_failures_are_not_cached(monkeypatch):
    calls = 0

    async def fetch(identifier, kind):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise municipal.MunicipalError("temporary source error")
        return {"type": "FeatureCollection", "features": []}

    monkeypatch.setattr(municipal, "_fetch_core_predio", fetch)

    async def scenario():
        with pytest.raises(municipal.MunicipalError):
            await municipal.lookup_core_predio("627739", "n_predio")
        assert len(municipal.CORE_CACHE) == 0
        await municipal.lookup_core_predio("627739", "n_predio")
        assert calls == 2

    asyncio.run(scenario())


def test_cache_eviction_respects_count_and_weight():
    cache = AsyncTTLCache(ttl=60, max_entries=2, max_weight=6, weight=len)
    cache.put("first", "abc")
    cache.put("second", "de")
    assert cache.get("first") == "abc"  # Make first most recently used.
    cache.put("third", "x")
    assert list(cache.entries) == ["first", "third"]
    assert cache.total_weight == 4
    cache.put("too_large", "1234567")
    assert "too_large" not in cache.entries
    cache.put("fourth", "123456")
    assert list(cache.entries) == ["fourth"]
    assert cache.total_weight == 6


def test_lifespan_drains_abandoned_loads_before_closing_pool(monkeypatch):
    clients = install_transport(monkeypatch, lambda request: httpx.Response(200, json={}))

    async def scenario():
        stopped = [asyncio.Event(), asyncio.Event()]
        started = [asyncio.Event(), asyncio.Event()]
        never = asyncio.Event()

        def loader(index):
            async def wait():
                started[index].set()
                try:
                    await never.wait()
                finally:
                    assert not clients[0].is_closed
                    stopped[index].set()
            return wait

        async with main.lifespan(main.app):
            waiters = [asyncio.create_task(cache.load(("shutdown",), loader(index)))
                       for index, cache in enumerate((municipal.CORE_CACHE, pugs_batch.CACHE))]
            await asyncio.gather(*(event.wait() for event in started))
            for task in waiters:
                task.cancel()
            await asyncio.gather(*waiters, return_exceptions=True)
        assert all(event.is_set() for event in stopped)
        assert not municipal.CORE_CACHE.inflight and not pugs_batch.CACHE.inflight
        assert clients[0].is_closed

    asyncio.run(scenario())


def test_upstream_concurrency_limit_is_shared_across_callers(monkeypatch):
    async def scenario():
        active = peak = 0
        four_started, release = asyncio.Event(), asyncio.Event()

        async def handler(request):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            if active == 4:
                four_started.set()
            try:
                await release.wait()
                return httpx.Response(200, json={})
            finally:
                active -= 1

        clients = install_transport(monkeypatch, handler)
        async with municipal_http.client_lifespan():
            async with municipal_http.municipal_client() as client:
                tasks = [asyncio.create_task(municipal_http.get(client, f"https://municipal.test/{i}", params={}))
                         for i in range(8)]
                await asyncio.wait_for(four_started.wait(), 1)
                await asyncio.sleep(0)
                assert peak == 4
                release.set()
                await asyncio.gather(*tasks)
        assert peak == 4 and clients[0].is_closed

    asyncio.run(scenario())
