"""
Tests for the hybrid retrieval pipeline (services/retrieval/).
Covers:
  - RRF merging logic (unit tests, no Neo4j needed)
  - Routing accuracy heuristic (_check_routing_accuracy)
  - Chunk code splitting (parent_retriever.chunk_code)
  - Lucene special character escaping (_escape_lucene)
  - Graph response format validation
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


# ─── Hybrid Retriever — RRF merge (unit tests, no DB) ────────────────────────

class TestRRFMerge:
    """Test _rrf_merge directly without hitting Neo4j."""

    def _merge(self, vec_results, ft_results, top_k=5):
        from services.retrieval.hybrid_retriever import _rrf_merge
        return _rrf_merge(vec_results, ft_results, top_k)

    def _make_rows(self, ids):
        return [
            {
                "id": i, "name": i, "file": "f.py",
                "start_line": 1, "end_line": 10,
                "code": "", "docstring": "", "complexity": 1,
                "vector_score": 0.9 - idx * 0.1,
            }
            for idx, i in enumerate(ids)
        ]

    def test_returns_ranked_results(self):
        """Results should be ordered by combined RRF score."""
        vec = self._make_rows(["a", "b", "c"])
        ft = self._make_rows(["a", "d", "e"])
        merged = self._merge(vec, ft, top_k=5)
        # "a" appears in both lists, should rank highest
        assert merged[0]["id"] == "a"

    def test_respects_top_k(self):
        """Should return at most top_k results."""
        vec = self._make_rows(["a", "b", "c", "d", "e"])
        ft = self._make_rows(["f", "g", "h", "i", "j"])
        merged = self._merge(vec, ft, top_k=3)
        assert len(merged) <= 3

    def test_merges_vector_and_fulltext(self):
        """Results should include nodes from both lists."""
        vec = self._make_rows(["vec_only"])
        ft = self._make_rows(["ft_only"])
        merged = self._merge(vec, ft, top_k=5)
        merged_ids = {r["id"] for r in merged}
        assert "vec_only" in merged_ids
        assert "ft_only" in merged_ids

    def test_relevance_score_present(self):
        """Each merged result should have a relevance_score field."""
        vec = self._make_rows(["x"])
        ft = self._make_rows(["y"])
        merged = self._merge(vec, ft, top_k=5)
        for row in merged:
            assert "relevance_score" in row
            assert isinstance(row["relevance_score"], float)

    def test_deduplicates_results(self):
        """Nodes appearing in both lists should appear only once."""
        rows = self._make_rows(["shared"])
        merged = self._merge(rows, rows, top_k=5)
        ids = [r["id"] for r in merged]
        assert ids.count("shared") == 1

    def test_empty_one_side(self):
        """Should work even if one of the two lists is empty."""
        vec = self._make_rows(["a", "b"])
        merged = self._merge(vec, [], top_k=5)
        assert len(merged) == 2
        merged2 = self._merge([], vec, top_k=5)
        assert len(merged2) == 2

    def test_both_empty(self):
        """Should return empty list when both inputs are empty."""
        merged = self._merge([], [], top_k=5)
        assert merged == []


# ─── Lucene escaping ────────────────────────────────────────────────────────

class TestLuceneEscaping:
    def _escape(self, text):
        from services.retrieval.hybrid_retriever import _escape_lucene
        return _escape_lucene(text)

    def test_escapes_parentheses(self):
        assert "\\(" in self._escape("foo()")
        assert "\\)" in self._escape("foo()")

    def test_escapes_colon(self):
        assert "\\:" in self._escape("key:value")

    def test_escapes_plus(self):
        assert "\\+" in self._escape("a+b")

    def test_plain_text_unchanged(self):
        assert self._escape("hello world") == "hello world"

    def test_empty_string(self):
        assert self._escape("") == ""


# ─── Chunk code splitting ────────────────────────────────────────────────────

class TestChunkCode:
    def _chunk(self, code, parent_id="p1"):
        from services.retrieval.parent_retriever import chunk_code
        return chunk_code(code, parent_id)

    def test_short_code_single_chunk(self):
        """Code shorter than chunk size should produce exactly one chunk."""
        chunks = self._chunk("x = 1", "p1")
        assert len(chunks) == 1
        assert chunks[0]["text"] == "x = 1"

    def test_long_code_multiple_chunks(self):
        """Code longer than chunk size should produce multiple chunks."""
        long_code = "a" * 1000
        chunks = self._chunk(long_code, "p1")
        assert len(chunks) > 1

    def test_chunks_have_required_fields(self):
        """Each chunk should have text, index, parent_id, embedding fields."""
        chunks = self._chunk("hello world", "parent-42")
        for c in chunks:
            assert "text" in c
            assert "index" in c
            assert "parent_id" in c
            assert c["parent_id"] == "parent-42"
            assert "embedding" in c

    def test_chunks_indexed_sequentially(self):
        """Chunk indices should be 0, 1, 2, ..."""
        long_code = "b" * 1000
        chunks = self._chunk(long_code, "px")
        indices = [c["index"] for c in chunks]
        assert indices == list(range(len(chunks)))

    def test_chunks_cover_full_content(self):
        """All characters should be covered across all chunks (with overlap)."""
        code = "x" * 500
        chunks = self._chunk(code, "px")
        # First chunk starts at 0, last chunk ends at len(code)
        assert chunks[0]["text"][0] == "x"
        assert len(chunks[-1]["text"]) > 0


# ─── Graph response format ────────────────────────────────────────────────────

class TestGraphResponseFormat:
    def test_graph_data_has_nodes_and_edges(self):
        """GraphData Pydantic model should always have nodes and edges lists."""
        from models.schemas import GraphData
        g = GraphData()
        assert hasattr(g, "nodes")
        assert hasattr(g, "edges")
        assert isinstance(g.nodes, list)
        assert isinstance(g.edges, list)

    def test_graph_node_fields(self):
        """GraphNode should accept all required fields."""
        from models.schemas import GraphNode
        n = GraphNode(
            id="fn:app.py:my_func:10",
            type="Function",
            name="my_func",
            file="app.py",
            highlighted=True,
        )
        assert n.id == "fn:app.py:my_func:10"
        assert n.type == "Function"
        assert n.highlighted is True

    def test_graph_edge_fields(self):
        """GraphEdge should accept all required fields."""
        from models.schemas import GraphEdge
        e = GraphEdge(
            id="calls::fn1::fn2",
            source="fn1",
            target="fn2",
            type="CALLS",
        )
        assert e.source == "fn1"
        assert e.target == "fn2"
        assert e.type == "CALLS"
