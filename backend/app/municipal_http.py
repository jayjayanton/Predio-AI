"""Reusable municipal HTTP connections and a per-worker request limit."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from weakref import WeakKeyDictionary, ref

import httpx

MAX_CONCURRENT_REQUESTS = 4
_clients: dict[asyncio.AbstractEventLoop, httpx.AsyncClient] = {}
_limits: WeakKeyDictionary = WeakKeyDictionary()


def _limit():
    loop = asyncio.get_running_loop()
    saved = _limits.get(loop)
    limit = saved() if saved is not None else None
    if limit is None:
        limit = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        _limits[loop] = ref(limit)
    return limit


def _new_client(timeout=30.0):
    return httpx.AsyncClient(
        timeout=timeout, follow_redirects=False,
        limits=httpx.Limits(max_connections=MAX_CONCURRENT_REQUESTS,
                           max_keepalive_connections=MAX_CONCURRENT_REQUESTS),
    )


@asynccontextmanager
async def client_lifespan():
    """Own one connection pool for the FastAPI worker's event loop."""
    loop = asyncio.get_running_loop()
    if loop in _clients:
        yield
        return
    async with _new_client() as client:
        _clients[loop] = client
        try:
            yield
        finally:
            _clients.pop(loop, None)
            _limits.pop(loop, None)


@asynccontextmanager
async def municipal_client(timeout=30.0):
    """Allow standalone scripts/tests to use a safely scoped fallback pool."""
    client = _clients.get(asyncio.get_running_loop())
    if client is not None:
        yield client
    else:
        async with _new_client(timeout) as client:
            yield client


async def get(client, url, *, params, timeout=30.0):
    async with _limit():
        return await client.get(url, params=params, timeout=timeout)


async def post(client, url, *, data, timeout=30.0):
    async with _limit():
        return await client.post(url, data=data, timeout=timeout)
