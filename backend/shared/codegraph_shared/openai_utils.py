"""Shared OpenAI API utilities: embed and chat."""

from __future__ import annotations

import json
import logging
import random
import socket
import time
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

from fastapi import HTTPException

logger = logging.getLogger("codegraph_shared.openai_utils")

_RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({429, 500, 502, 503, 504})
_OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings"
_OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


def embed(
    inputs: list[str],
    *,
    model: str,
    api_key: str,
    timeout: float,
    max_retries: int,
    backoff_base: float = 0.5,
    backoff_cap: float = 10.0,
    dimensions: int | None = None,
) -> list[list[float]]:
    """Embed a batch of strings via OpenAI. Returns a list of float vectors in input order."""
    if not inputs:
        return []
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY is required for embedding operations.",
        )

    payload: dict[str, Any] = {"model": model, "input": inputs}
    if dimensions and model.startswith("text-embedding-3"):
        payload["dimensions"] = dimensions

    payload_bytes = json.dumps(payload).encode("utf-8")
    data: dict | None = None
    last_error = "unknown embedding error"
    attempt = 0

    while attempt < max_retries:
        attempt += 1
        req = urlrequest.Request(
            _OPENAI_EMBED_URL,
            data=payload_bytes,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlrequest.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urlerror.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore").strip()
            status = int(exc.code)
            last_error = f"http {status}: {detail or 'no response body'}"

            if status == 401:
                raise HTTPException(
                    status_code=401,
                    detail=f"OpenAI embedding unauthorized (invalid API key): {detail or 'no body'}",
                ) from exc

            if 400 <= status < 500 and status != 429:
                raise HTTPException(
                    status_code=502,
                    detail=f"OpenAI embedding rejected (non-retryable {status}): {detail or 'no body'}",
                ) from exc

            if status not in _RETRYABLE_STATUS_CODES or attempt >= max_retries:
                raise HTTPException(
                    status_code=502,
                    detail=f"OpenAI embedding failed after {attempt} attempt(s); last: {status}: {detail or 'no body'}",
                ) from exc

            sleep_sec = random.uniform(0.0, min(backoff_cap, backoff_base * (2 ** (attempt - 1))))
            logger.warning("openai.embed.retry attempt=%s/%s status=%s sleep=%.2f", attempt, max_retries, status, sleep_sec)
            time.sleep(sleep_sec)

        except (urlerror.URLError, TimeoutError, socket.timeout) as exc:
            reason = str(getattr(exc, "reason", exc)).strip() or exc.__class__.__name__
            last_error = f"network: {reason}"

            if attempt >= max_retries:
                raise HTTPException(
                    status_code=502,
                    detail=f"OpenAI embedding unavailable after {attempt} attempt(s): {reason}",
                ) from exc

            sleep_sec = random.uniform(0.0, min(backoff_cap, backoff_base * (2 ** (attempt - 1))))
            logger.warning("openai.embed.retry attempt=%s/%s network=%s sleep=%.2f", attempt, max_retries, reason, sleep_sec)
            time.sleep(sleep_sec)

        except json.JSONDecodeError as exc:
            last_error = f"invalid json: {exc}"
            if attempt >= max_retries:
                raise HTTPException(
                    status_code=502,
                    detail=f"OpenAI embedding returned invalid JSON after {attempt} attempt(s): {exc}",
                ) from exc
            sleep_sec = random.uniform(0.0, min(backoff_cap, backoff_base * (2 ** (attempt - 1))))
            logger.warning("openai.embed.retry attempt=%s/%s parse_error=%s sleep=%.2f", attempt, max_retries, exc, sleep_sec)
            time.sleep(sleep_sec)

    if data is None:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI embedding failed after {max_retries} attempt(s): {last_error}",
        )

    if not isinstance(data, dict) or "data" not in data:
        raise HTTPException(status_code=502, detail="Invalid response structure from OpenAI embeddings API")

    items = sorted(data["data"], key=lambda item: item.get("index", 0))
    vectors = [item.get("embedding", []) for item in items]
    if len(vectors) != len(inputs):
        raise HTTPException(status_code=502, detail="OpenAI embedding response count mismatch")
    return vectors


def chat(
    messages: list[dict[str, str]],
    *,
    model: str,
    api_key: str,
    timeout: float,
    temperature: float = 0.2,
    response_format: dict[str, str] | None = None,
) -> str:
    """Send a chat completion request to OpenAI. Returns the assistant message content string."""
    if not api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY is required for LLM chat.")

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format

    req = urlrequest.Request(
        _OPENAI_CHAT_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return str(data["choices"][0]["message"]["content"]).strip()
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"OpenAI chat failed ({exc.code}): {detail}") from exc
    except urlerror.URLError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI chat unavailable: {exc.reason}") from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=502, detail="OpenAI chat timed out") from exc
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"Invalid OpenAI chat response: {exc}") from exc
