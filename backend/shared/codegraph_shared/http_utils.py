"""Shared HTTP utilities for inter-service communication."""

from __future__ import annotations

import json
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from fastapi import HTTPException


def post_json(url: str, payload: dict, timeout: float) -> dict:
    """POST JSON to a service URL. Raises HTTPException on any error."""
    req = urlrequest.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=502,
            detail=f"upstream POST {url} failed ({exc.code}): {detail or 'no body'}",
        ) from exc
    except urlerror.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"upstream POST {url} unavailable: {exc.reason}",
        ) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"upstream POST {url} returned invalid JSON: {exc}",
        ) from exc


def get_json(url: str, params: dict[str, str], timeout: float) -> dict:
    """GET JSON from a service URL with query params. Raises HTTPException on any error."""
    query = urlparse.urlencode(params)
    full_url = f"{url}?{query}" if query else url
    req = urlrequest.Request(full_url, method="GET")
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=502,
            detail=f"upstream GET {full_url} failed ({exc.code}): {detail or 'no body'}",
        ) from exc
    except urlerror.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"upstream GET {full_url} unavailable: {exc.reason}",
        ) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"upstream GET {full_url} returned invalid JSON: {exc}",
        ) from exc
