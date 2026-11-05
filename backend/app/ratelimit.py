"""Tiny in-memory sliding-window rate limiter (per process). Enough to slow down password guessing
and upload floods on one server; a real deployment would also rate-limit at the proxy."""

import time
from collections import defaultdict, deque

from fastapi import HTTPException

_hits = defaultdict(deque)


def hit(key, limit, window_s, message="Too many requests. Please wait a few minutes and try again."):
    if limit <= 0:
        return
    now = time.time()
    q = _hits[key]
    while q and now - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, message)
    q.append(now)
    if len(_hits) > 20000:  # keep memory bounded
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > window_s][:5000]:
            _hits.pop(k, None)


def clear(prefix=""):
    for k in [k for k in _hits if k.startswith(prefix)]:
        _hits.pop(k, None)


def failures(key, window_s):
    now = time.time()
    q = _hits[key]
    while q and now - q[0] > window_s:
        q.popleft()
    return len(q)
