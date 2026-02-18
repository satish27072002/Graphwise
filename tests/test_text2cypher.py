"""
Tests for the text2Cypher service (services/retrieval/text2cypher.py).
Covers:
  - Structural question detection (is_structural_question)
  - Cypher sanitisation (_sanitize_cypher)
  - Cypher cleaning (_clean_cypher — strips markdown fences)
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


# ─── Structural question detection ───────────────────────────────────────────

class TestStructuralQuestionDetection:
    def _is_structural(self, question: str) -> bool:
        from services.retrieval.text2cypher import is_structural_question
        return is_structural_question(question)

    # ── Count questions ──────────────────────────────────────────────────────

    def test_detects_how_many_functions(self):
        assert self._is_structural("How many functions call process_payment?") is True

    def test_detects_how_many_classes(self):
        assert self._is_structural("How many classes are in this repo?") is True

    def test_detects_count_verb(self):
        assert self._is_structural("Count all functions in the auth module") is True

    # ── Import questions (keyword-matched forms) ─────────────────────────────

    def test_detects_what_imports(self):
        """'What imports X' matches the \bwhat imports\b pattern."""
        assert self._is_structural("What imports UserService?") is True

    def test_detects_list_all_functions(self):
        assert self._is_structural("List all functions in models.py") is True

    def test_detects_list_subclasses(self):
        assert self._is_structural("List all subclasses of AbstractHandler") is True

    # ── Show all questions ────────────────────────────────────────────────────

    def test_detects_show_all_classes(self):
        assert self._is_structural("Show all classes that extend BaseView") is True

    # ── Dependency keyword ────────────────────────────────────────────────────

    def test_detects_dependency_keyword(self):
        """Questions with the word 'dependency' are structural."""
        assert self._is_structural("Show the dependency graph for auth") is True

    def test_detects_dependencies_keyword(self):
        assert self._is_structural("List all dependencies of UserService") is True

    # ── Impact / breaks-if ────────────────────────────────────────────────────

    def test_detects_breaks_if(self):
        assert self._is_structural("What breaks if I change User.save?") is True

    def test_detects_impact_of(self):
        assert self._is_structural("What is the impact of removing validate_input?") is True

    # ── Semantic questions (should NOT be structural) ─────────────────────────

    def test_rejects_how_does_auth_work(self):
        assert self._is_structural("How does authentication work?") is False

    def test_rejects_explain_caching(self):
        assert self._is_structural("Explain how the caching layer works") is False

    def test_rejects_what_does_func_do(self):
        assert self._is_structural("What does the login function do?") is False

    def test_rejects_show_me_db_queries(self):
        assert self._is_structural("Show me all database queries in the payment flow") is False

    def test_rejects_password_hashing(self):
        assert self._is_structural("How does the password hashing work?") is False

    def test_rejects_explain_pipeline(self):
        assert self._is_structural("Explain how the request pipeline works") is False


# ─── Cypher sanitisation ─────────────────────────────────────────────────────

class TestCypherSanitisation:
    def _sanitize(self, cypher: str) -> str:
        from services.retrieval.text2cypher import _sanitize_cypher
        return _sanitize_cypher(cypher)

    def test_blocks_create(self):
        with pytest.raises(ValueError):
            self._sanitize("CREATE (n:Function {name: 'hack'})")

    def test_blocks_merge(self):
        with pytest.raises(ValueError):
            self._sanitize("MERGE (n:Function {id: 'x'}) ON CREATE SET n.code = 'evil'")

    def test_blocks_delete(self):
        with pytest.raises(ValueError):
            self._sanitize("MATCH (n) DELETE n")

    def test_blocks_detach_delete(self):
        with pytest.raises(ValueError):
            self._sanitize("MATCH (n) DETACH DELETE n")

    def test_blocks_set(self):
        with pytest.raises(ValueError):
            self._sanitize("MATCH (n) SET n.name = 'x'")

    def test_blocks_remove(self):
        with pytest.raises(ValueError):
            self._sanitize("MATCH (n) REMOVE n.code")

    def test_blocks_drop(self):
        with pytest.raises(ValueError):
            self._sanitize("DROP INDEX function_embeddings")

    def test_allows_match_return(self):
        """Safe read-only MATCH queries should pass through unchanged."""
        cypher = "MATCH (f:Function) RETURN f.name"
        result = self._sanitize(cypher)
        assert result == cypher

    def test_allows_match_where_return(self):
        cypher = "MATCH (f:Function) WHERE f.codebase_id = $cid RETURN f.name, f.file"
        result = self._sanitize(cypher)
        assert result == cypher

    def test_allows_match_with_count(self):
        """COUNT queries are read-only and should pass."""
        cypher = "MATCH (f:Function) WHERE f.codebase_id = $cid RETURN count(f) AS total"
        result = self._sanitize(cypher)
        assert result == cypher

    def test_allows_match_order_by(self):
        cypher = (
            "MATCH (f:Function) WHERE f.codebase_id = $cid "
            "RETURN f.name, f.complexity ORDER BY f.complexity DESC LIMIT 10"
        )
        result = self._sanitize(cypher)
        assert result == cypher


# ─── Cypher cleaning (markdown fence stripping) ───────────────────────────────

class TestCypherCleaning:
    def _clean(self, raw: str) -> str:
        from services.retrieval.text2cypher import _clean_cypher
        return _clean_cypher(raw)

    def test_strips_cypher_fence(self):
        raw = "```cypher\nMATCH (n) RETURN n\n```"
        assert self._clean(raw) == "MATCH (n) RETURN n"

    def test_strips_generic_fence(self):
        raw = "```\nMATCH (n) RETURN n\n```"
        assert self._clean(raw) == "MATCH (n) RETURN n"

    def test_strips_whitespace(self):
        raw = "  \n  MATCH (n) RETURN n  \n  "
        assert self._clean(raw) == "MATCH (n) RETURN n"

    def test_plain_cypher_unchanged(self):
        raw = "MATCH (f:Function) WHERE f.name = $name RETURN f"
        assert self._clean(raw) == raw

    def test_empty_string(self):
        assert self._clean("") == ""

    def test_cypher_fence_uppercase_label(self):
        raw = "```CYPHER\nMATCH (n) RETURN n\n```"
        # The regex uses [a-zA-Z]* so uppercase should also be stripped
        result = self._clean(raw)
        assert "```" not in result
