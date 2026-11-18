"""Small process-local TTL/LRU cache with shared in-flight loads.

Completed entries are bounded by count and caller-supplied memory weight.
Failed loads are not cached. Cancelling one waiter does not cancel a load
another request is awaiting; shutdown explicitly drains the remaining tasks.
"""
from __future__ import annotations

import asyncio
import time
from collections import OrderedDict

_MISSING = object()


class AsyncTTLCache:
    def __init__(self, *, ttl, max_entries, max_weight, weight):
        self.ttl = ttl
        self.max_entries = max_entries
        self.max_weight = max_weight
        self.weight = weight
        self.entries = OrderedDict()
        self.inflight = {}
        self.total_weight = 0

    def __len__(self):
        return len(self.entries)

    def clear(self):
        self.entries.clear()
        self.total_weight = 0

    def _remove(self, key):
        entry = self.entries.pop(key, None)
        if entry is not None:
            self.total_weight -= entry[2]

    def get(self, key):
        entry = self.entries.get(key)
        if entry is None:
            return _MISSING
        stamp, value, _ = entry
        if time.monotonic() - stamp >= self.ttl:
            self._remove(key)
            return _MISSING
        self.entries.move_to_end(key)
        return value

    def put(self, key, value):
        size = self.weight(value)
        self._remove(key)
        if size > self.max_weight:
            return
        self.entries[key] = (time.monotonic(), value, size)
        self.total_weight += size
        while len(self.entries) > self.max_entries or self.total_weight > self.max_weight:
            self._remove(next(iter(self.entries)))

    async def load(self, key, loader):
        value = self.get(key)
        if value is not _MISSING:
            return value, "hit"
        pending_key = (asyncio.get_running_loop(), key)
        task = self.inflight.get(pending_key)
        state = "shared" if task is not None else "loaded"
        if task is None:
            async def populate():
                value = await loader()
                self.put(key, value)
                return value

            task = asyncio.create_task(populate())
            self.inflight[pending_key] = task

            def finished(done):
                if self.inflight.get(pending_key) is done:
                    self.inflight.pop(pending_key, None)
                # Consume exceptions even if all original waiters disconnected.
                if not done.cancelled():
                    done.exception()

            task.add_done_callback(finished)
        return await asyncio.shield(task), state

    async def close(self):
        loop = asyncio.get_running_loop()
        pending = [(key, task) for key, task in self.inflight.items() if key[0] is loop]
        tasks = [task for _, task in pending]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for key, task in pending:
            if self.inflight.get(key) is task:
                self.inflight.pop(key, None)
        self.clear()
