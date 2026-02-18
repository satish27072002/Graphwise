"""
Evaluation benchmark for CodeGraph Navigator.
Runs test cases from test_cases.json through the full query pipeline
and measures:
  - Answer relevance (LLM-as-judge scoring 0-1)
  - Retrieval accuracy (were expected node names present in sources?)
  - Routing accuracy (was the right retrieval method used?)
  - Latency (end-to-end query time in ms)

Usage:
  # From the backend directory (with uvicorn running on :8000):
  python -m evals.benchmark

  # Or via httpx against a running instance:
  BASE_URL=http://localhost:8000 python -m evals.benchmark

  # With a specific codebase_id override (all test cases use that codebase):
  CODEBASE_ID=myrepo python -m evals.benchmark
"""

import json
import asyncio
import os
import sys
import time
import textwrap
from pathlib import Path
from typing import Optional

# ─── Optional httpx (graceful import) ────────────────────────────────────────
try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False

# ─── Optional openai (for LLM-as-judge) ──────────────────────────────────────
try:
    from openai import AsyncOpenAI
    _HAS_OPENAI = True
except ImportError:
    _HAS_OPENAI = False

# ─── Config ───────────────────────────────────────────────────────────────────
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
CODEBASE_ID_OVERRIDE = os.getenv("CODEBASE_ID", "")   # override all test case codebase_ids

# LLM-as-judge model (cheap, fast)
_JUDGE_MODEL = "gpt-4o-mini"

# Relevance score threshold to count a case as "passed"
_PASS_THRESHOLD = 0.6

# ─── Test case loading ────────────────────────────────────────────────────────

def load_test_cases() -> list[dict]:
    """Load test cases from test_cases.json."""
    cases_path = Path(__file__).parent / "test_cases.json"
    with open(cases_path) as f:
        return json.load(f)


# ─── HTTP query helper ────────────────────────────────────────────────────────

async def _query_api(
    client: "httpx.AsyncClient",
    question: str,
    codebase_id: str,
    top_k: int = 5,
    hops: int = 2,
) -> tuple[dict, float]:
    """
    Call POST /query and return (response_dict, elapsed_ms).
    Returns an error dict on failure.
    """
    payload = {
        "question": question,
        "codebase_id": codebase_id,
        "top_k": top_k,
        "hops": hops,
    }
    t0 = time.monotonic()
    try:
        resp = await client.post(f"{BASE_URL}/query", json=payload, timeout=60.0)
        elapsed_ms = (time.monotonic() - t0) * 1000
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}: {resp.text[:200]}"}, elapsed_ms
        return resp.json(), elapsed_ms
    except Exception as exc:
        elapsed_ms = (time.monotonic() - t0) * 1000
        return {"error": str(exc)}, elapsed_ms


# ─── LLM-as-judge scoring ────────────────────────────────────────────────────

_JUDGE_SYSTEM = textwrap.dedent("""
    You are an expert evaluator for a code understanding AI system.
    Given a developer question and an AI-generated answer about a codebase,
    score how relevant and accurate the answer is.

    Scoring criteria:
    - 1.0 : The answer directly and accurately addresses the question
    - 0.8 : The answer is mostly correct with minor gaps
    - 0.6 : The answer is partially relevant but missing key details
    - 0.4 : The answer is tangentially related but mostly off-target
    - 0.2 : The answer is not relevant to the question
    - 0.0 : The answer is an error or completely irrelevant

    Respond with ONLY a JSON object: {"score": <float>, "reason": "<one sentence>"}
""").strip()


async def _judge_relevance(
    openai_client: "AsyncOpenAI",
    question: str,
    answer: str,
) -> tuple[float, str]:
    """
    Use gpt-4o-mini as judge to score answer relevance (0.0 - 1.0).
    Returns (score, reason). Falls back to 0.5 on any error.
    """
    if not _HAS_OPENAI or not OPENAI_API_KEY:
        return 0.5, "OpenAI unavailable — skipping LLM judge"

    user_prompt = (
        f"QUESTION: {question}\n\n"
        f"ANSWER:\n{answer[:2000]}"
    )
    try:
        resp = await openai_client.chat.completions.create(
            model=_JUDGE_MODEL,
            messages=[
                {"role": "system", "content": _JUDGE_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0,
            max_tokens=100,
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        score = float(parsed.get("score", 0.5))
        reason = parsed.get("reason", "")
        return min(max(score, 0.0), 1.0), reason
    except Exception as exc:
        return 0.5, f"Judge error: {exc}"


# ─── Retrieval accuracy ───────────────────────────────────────────────────────

def _check_retrieval_accuracy(
    expected_node_names: list[str],
    sources: list[dict],
) -> float:
    """
    Check what fraction of expected_node_names appear in the returned sources.
    Returns 1.0 if expected_node_names is empty (nothing to check).
    """
    if not expected_node_names:
        return 1.0
    returned_names = {s.get("name", "") for s in sources}
    hits = sum(1 for name in expected_node_names if name in returned_names)
    return hits / len(expected_node_names)


# ─── Routing accuracy ────────────────────────────────────────────────────────

def _check_routing_accuracy(
    expected_method: str,
    actual_method: str,
) -> bool:
    """
    Check if the retrieval method matches expectations.
    Uses prefix matching to handle variants like
    'hybrid + graph expansion (text2cypher fallback)'.
    """
    if not expected_method:
        return True
    expected_lower = expected_method.lower()
    actual_lower = (actual_method or "").lower()
    # text2cypher test: actual must contain 'text2cypher'
    if "text2cypher" in expected_lower:
        return "text2cypher" in actual_lower
    # hybrid test: actual must contain 'hybrid'
    if "hybrid" in expected_lower:
        return "hybrid" in actual_lower
    return expected_lower in actual_lower


# ─── Single test case runner ──────────────────────────────────────────────────

async def _run_test_case(
    case: dict,
    client: "httpx.AsyncClient",
    openai_client: Optional["AsyncOpenAI"],
) -> dict:
    """
    Run a single test case and return a result dict.
    """
    codebase_id = CODEBASE_ID_OVERRIDE or case.get("codebase_id", "default")
    question = case["question"]
    case_id = case.get("id", "?")

    print(f"  [{case_id}] {question[:70]}", flush=True)

    response, latency_ms = await _query_api(client, question, codebase_id)

    if "error" in response:
        print(f"    ERROR: {response['error']}", flush=True)
        return {
            "id": case_id,
            "question": question,
            "codebase_id": codebase_id,
            "answer": "",
            "retrieval_method": "",
            "cypher_used": None,
            "relevance_score": 0.0,
            "relevance_reason": response["error"],
            "retrieval_accuracy": 0.0,
            "routing_correct": False,
            "latency_ms": round(latency_ms, 1),
            "passed": False,
            "error": response["error"],
        }

    answer = response.get("answer", "")
    sources = response.get("sources", [])
    actual_method = response.get("retrieval_method", "")
    cypher_used = response.get("cypher_used")

    # LLM-as-judge relevance
    if openai_client:
        relevance_score, relevance_reason = await _judge_relevance(
            openai_client, question, answer
        )
    else:
        relevance_score, relevance_reason = 0.5, "LLM judge skipped"

    # Retrieval accuracy
    retrieval_accuracy = _check_retrieval_accuracy(
        case.get("expected_node_names", []), sources
    )

    # Routing accuracy
    routing_correct = _check_routing_accuracy(
        case.get("expected_retrieval_method", ""), actual_method
    )

    passed = (
        relevance_score >= _PASS_THRESHOLD
        and routing_correct
    )

    print(
        f"    relevance={relevance_score:.2f} routing={'OK' if routing_correct else 'WRONG'} "
        f"retrieval={retrieval_accuracy:.2f} latency={latency_ms:.0f}ms "
        f"{'PASS' if passed else 'FAIL'}",
        flush=True,
    )

    return {
        "id": case_id,
        "question": question,
        "codebase_id": codebase_id,
        "answer": answer[:500],
        "retrieval_method": actual_method,
        "cypher_used": cypher_used,
        "relevance_score": round(relevance_score, 3),
        "relevance_reason": relevance_reason,
        "retrieval_accuracy": round(retrieval_accuracy, 3),
        "routing_correct": routing_correct,
        "latency_ms": round(latency_ms, 1),
        "passed": passed,
        "error": None,
    }


# ─── Main benchmark runner ────────────────────────────────────────────────────

async def run_benchmark(
    cases: Optional[list[dict]] = None,
    concurrency: int = 3,
) -> dict:
    """
    Run all test cases (or the provided list) and return a summary dict:
    {
      "total": int,
      "passed": int,
      "pass_rate": float,
      "avg_relevance_score": float,
      "avg_retrieval_accuracy": float,
      "routing_accuracy": float,
      "avg_latency_ms": float,
      "p95_latency_ms": float,
      "results": [...]
    }
    """
    if not _HAS_HTTPX:
        print("ERROR: httpx not installed. Run: pip install httpx", file=sys.stderr)
        return {}

    if cases is None:
        cases = load_test_cases()

    openai_client = None
    if _HAS_OPENAI and OPENAI_API_KEY:
        openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

    print(f"\n{'='*60}")
    print(f"CodeGraph Navigator — Evaluation Benchmark")
    print(f"{'='*60}")
    print(f"  Base URL   : {BASE_URL}")
    print(f"  Test cases : {len(cases)}")
    print(f"  LLM judge  : {'enabled (' + _JUDGE_MODEL + ')' if openai_client else 'disabled'}")
    print(f"  Concurrency: {concurrency}")
    print(f"{'='*60}\n")

    # Run cases with bounded concurrency
    semaphore = asyncio.Semaphore(concurrency)
    results: list[dict] = []

    async with httpx.AsyncClient() as client:
        async def run_with_semaphore(case: dict) -> dict:
            async with semaphore:
                return await _run_test_case(case, client, openai_client)

        tasks = [run_with_semaphore(c) for c in cases]
        results = await asyncio.gather(*tasks)

    # ── Compute summary metrics ──────────────────────────────────────────────
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    errors = sum(1 for r in results if r.get("error"))

    relevance_scores = [r["relevance_score"] for r in results if not r.get("error")]
    retrieval_accuracies = [r["retrieval_accuracy"] for r in results if not r.get("error")]
    routing_corrects = [r["routing_correct"] for r in results if not r.get("error")]
    latencies = [r["latency_ms"] for r in results if not r.get("error")]

    avg_relevance = sum(relevance_scores) / len(relevance_scores) if relevance_scores else 0.0
    avg_retrieval = sum(retrieval_accuracies) / len(retrieval_accuracies) if retrieval_accuracies else 0.0
    routing_accuracy = sum(routing_corrects) / len(routing_corrects) if routing_corrects else 0.0
    avg_latency = sum(latencies) / len(latencies) if latencies else 0.0
    p95_latency = sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 0.0

    summary = {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "errors": errors,
        "pass_rate": round(passed / total, 3) if total else 0.0,
        "avg_relevance_score": round(avg_relevance, 3),
        "avg_retrieval_accuracy": round(avg_retrieval, 3),
        "routing_accuracy": round(routing_accuracy, 3),
        "avg_latency_ms": round(avg_latency, 1),
        "p95_latency_ms": round(p95_latency, 1),
        "results": list(results),
    }

    # ── Print summary table ──────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"BENCHMARK RESULTS")
    print(f"{'='*60}")
    print(f"  Total cases        : {total}")
    print(f"  Passed             : {passed} / {total}  ({summary['pass_rate']*100:.1f}%)")
    print(f"  Errors             : {errors}")
    print(f"  Avg relevance      : {avg_relevance:.3f}")
    print(f"  Avg retrieval acc  : {avg_retrieval:.3f}")
    print(f"  Routing accuracy   : {routing_accuracy*100:.1f}%")
    print(f"  Avg latency        : {avg_latency:.0f} ms")
    print(f"  P95 latency        : {p95_latency:.0f} ms")
    print(f"{'='*60}\n")

    # ── Per-case table ───────────────────────────────────────────────────────
    print(f"{'ID':<8} {'Pass':<5} {'Rel':<6} {'Rtr':<6} {'Route':<7} {'ms':<7} Question")
    print("-" * 80)
    for r in results:
        status = "PASS" if r["passed"] else "FAIL"
        err = " [ERR]" if r.get("error") else ""
        q = r["question"][:42]
        print(
            f"{r['id']:<8} {status:<5} {r['relevance_score']:<6.2f} "
            f"{r['retrieval_accuracy']:<6.2f} "
            f"{'OK' if r['routing_correct'] else 'WRONG':<7} "
            f"{r['latency_ms']:<7.0f} {q}{err}"
        )

    return summary


# ─── Entrypoint ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    output_path = Path(__file__).parent / "benchmark_results.json"
    results = asyncio.run(run_benchmark())
    if results:
        with open(output_path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nResults saved to: {output_path}")
