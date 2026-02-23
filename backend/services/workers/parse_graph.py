from __future__ import annotations

import hashlib
import json
import os
import uuid
from pathlib import Path
from typing import Final

import tree_sitter_python as tspython
import tree_sitter_javascript as tsjavascript
import tree_sitter_typescript as tstypescript
import tree_sitter_java as tsjava
import tree_sitter_go as tsgo
import tree_sitter_rust as tsrust
from tree_sitter import Language, Parser


IGNORED_DIRS: Final[set[str]] = {
    ".git",
    "node_modules",
    "venv",
    "__pycache__",
    "dist",
    "build",
}
DEFAULT_MAX_SNIPPET_CHARS: Final[int] = int(os.getenv("MAX_SNIPPET_CHARS", "2000"))

# ──────────────────────────────────────────────────────────
# Language registry — maps file extension → (Language, lang_name)
# Lazily initialised on first use.
# ──────────────────────────────────────────────────────────
_LANG_CACHE: dict[str, Language] = {}


def _get_language(lang_name: str) -> Language:
    if lang_name not in _LANG_CACHE:
        mapping = {
            "python": tspython.language(),
            "javascript": tsjavascript.language(),
            "typescript": tstypescript.language_typescript(),
            "tsx": tstypescript.language_tsx(),
            "java": tsjava.language(),
            "go": tsgo.language(),
            "rust": tsrust.language(),
        }
        _LANG_CACHE[lang_name] = Language(mapping[lang_name])
    return _LANG_CACHE[lang_name]


_EXT_TO_LANG: Final[dict[str, str]] = {
    ".py":   "python",
    ".js":   "javascript",
    ".jsx":  "javascript",
    ".ts":   "typescript",
    ".tsx":  "tsx",
    ".java": "java",
    ".go":   "go",
    ".rs":   "rust",
}

# ──────────────────────────────────────────────────────────
# Tree-sitter node-type queries per language
# ──────────────────────────────────────────────────────────
# Each entry: list of (ts_node_type, graph_node_type, name_field)
_DEFINITION_NODES: dict[str, list[tuple[str, str, str]]] = {
    "python": [
        ("class_definition",             "class",    "name"),
        ("function_definition",          "function", "name"),
        ("decorated_definition",         "function", "name"),  # @decorator + def
    ],
    "javascript": [
        ("class_declaration",            "class",    "name"),
        ("function_declaration",         "function", "name"),
        ("arrow_function",               "function", "name"),
        ("method_definition",            "function", "name"),
        ("generator_function_declaration", "function", "name"),
    ],
    "typescript": [
        ("class_declaration",            "class",    "name"),
        ("function_declaration",         "function", "name"),
        ("arrow_function",               "function", "name"),
        ("method_definition",            "function", "name"),
        ("method_signature",             "function", "name"),
        ("abstract_class_declaration",   "class",    "name"),
        ("interface_declaration",        "class",    "name"),
    ],
    "tsx": [
        ("class_declaration",            "class",    "name"),
        ("function_declaration",         "function", "name"),
        ("arrow_function",               "function", "name"),
        ("method_definition",            "function", "name"),
        ("interface_declaration",        "class",    "name"),
    ],
    "java": [
        ("class_declaration",            "class",    "name"),
        ("interface_declaration",        "class",    "name"),
        ("enum_declaration",             "class",    "name"),
        ("method_declaration",           "function", "name"),
        ("constructor_declaration",      "function", "name"),
    ],
    "go": [
        ("type_declaration",             "class",    "name"),
        ("function_declaration",         "function", "name"),
        ("method_declaration",           "function", "name"),
        ("short_var_declaration",        "function", "left"),
    ],
    "rust": [
        ("struct_item",                  "class",    "name"),
        ("enum_item",                    "class",    "name"),
        ("trait_item",                   "class",    "name"),
        ("impl_item",                    "class",    "name"),
        ("function_item",                "function", "name"),
    ],
}

_IMPORT_NODES: dict[str, list[str]] = {
    "python":     ["import_statement", "import_from_statement"],
    "javascript": ["import_statement", "import_declaration"],
    "typescript": ["import_statement", "import_declaration"],
    "tsx":        ["import_statement", "import_declaration"],
    "java":       ["import_declaration"],
    "go":         ["import_spec"],
    "rust":       ["use_declaration"],
}

_CALL_NODES: dict[str, str] = {
    "python":     "call",
    "javascript": "call_expression",
    "typescript": "call_expression",
    "tsx":        "call_expression",
    "java":       "method_invocation",
    "go":         "call_expression",
    "rust":       "call_expression",
}


# ──────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────
def _stable_node_id(repo_id: uuid.UUID, path: str, symbol: str, node_type: str) -> str:
    raw = f"{repo_id}|{path}|{symbol}|{node_type}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _truncate_snippet(text: str, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def _relative_posix(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _iter_source_files(repo_dir: Path) -> list[tuple[Path, str]]:
    """Return (path, lang_name) pairs for all supported source files."""
    results: list[tuple[Path, str]] = []
    for root, dirnames, filenames in os.walk(repo_dir, topdown=True):
        dirnames[:] = [name for name in dirnames if name not in IGNORED_DIRS]
        for filename in filenames:
            ext = Path(filename).suffix.lower()
            lang = _EXT_TO_LANG.get(ext)
            if lang is not None:
                results.append((Path(root) / filename, lang))
    results.sort(key=lambda t: t[0])
    return results


def _node_text(node, source_bytes: bytes) -> str:
    return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="ignore")


def _find_name(node, field: str, source_bytes: bytes) -> str | None:
    """Extract the identifier text from a named child or direct child matching field."""
    # Try named field first
    child = node.child_by_field_name(field)
    if child is not None:
        return _node_text(child, source_bytes).strip()

    # For arrow functions / variable assignments the name comes from the parent
    # — fall back to using the parent's name field if available
    if node.parent is not None:
        parent = node.parent
        if parent.type in ("variable_declarator", "lexical_declaration", "variable_declaration"):
            name_child = parent.child_by_field_name("name")
            if name_child is not None:
                return _node_text(name_child, source_bytes).strip()
        # Short var declaration in Go: "name := func() {...}"
        if parent.type == "short_var_declaration":
            left_child = parent.child_by_field_name("left")
            if left_child is not None:
                return _node_text(left_child, source_bytes).strip()

    return None


def _extract_facts_treesitter(
    source_bytes: bytes,
    lang_name: str,
    rel_path: str,
    repo_id: uuid.UUID,
    max_snippet_chars: int,
) -> tuple[list[dict], list[tuple[str, str, str]]]:
    """Parse one file with Tree-sitter and return (nodes, edges) as raw dicts/tuples."""
    try:
        language = _get_language(lang_name)
    except Exception:
        return [], []

    parser = Parser(language)
    tree = parser.parse(source_bytes)
    root = tree.root_node

    nodes: list[dict] = []
    edges: list[tuple[str, str, str]] = []
    local_symbol_ids: dict[str, str] = {}

    source_text = source_bytes.decode("utf-8", errors="ignore")

    # File node
    file_symbol = rel_path
    file_node_id = _stable_node_id(repo_id, rel_path, file_symbol, "file")
    nodes.append({
        "id": file_node_id,
        "type": "file",
        "name": Path(rel_path).name,
        "path": rel_path,
        "code_snippet": _truncate_snippet(source_text, max_snippet_chars),
    })

    def_specs = _DEFINITION_NODES.get(lang_name, [])
    import_types = set(_IMPORT_NODES.get(lang_name, []))
    call_type = _CALL_NODES.get(lang_name)

    def walk(node) -> None:
        ts_type = node.type

        # Definition nodes → class/function
        for (match_type, graph_type, name_field) in def_specs:
            if ts_type == match_type:
                symbol_name = _find_name(node, name_field, source_bytes)
                if not symbol_name:
                    # For decorated definitions in Python, find inner def/class
                    if ts_type == "decorated_definition":
                        for child in node.children:
                            if child.type in ("function_definition", "class_definition", "async_function_definition"):
                                inner_name = _find_name(child, "name", source_bytes)
                                if inner_name:
                                    symbol_name = inner_name
                                    graph_type = "class" if child.type == "class_definition" else "function"
                                break
                if symbol_name:
                    snippet = _truncate_snippet(_node_text(node, source_bytes), max_snippet_chars)
                    node_id = _stable_node_id(repo_id, rel_path, symbol_name, graph_type)
                    if node_id not in {n["id"] for n in nodes}:
                        nodes.append({
                            "id": node_id,
                            "type": graph_type,
                            "name": symbol_name,
                            "path": rel_path,
                            "code_snippet": snippet,
                        })
                        edges.append((file_node_id, node_id, "contains"))
                        local_symbol_ids[symbol_name] = node_id
                break  # matched — don't test more spec entries

        # Import nodes → module
        if ts_type in import_types:
            # Extract module name from the node text (best-effort across all languages)
            raw_text = _node_text(node, source_bytes).strip()
            # Remove keywords and punctuation to get the module path
            for kw in ("import", "from", "use", "package"):
                raw_text = raw_text.replace(kw, "", 1).strip()
            module_name = raw_text.split()[0].rstrip(";").strip("\"'") if raw_text.split() else ""
            if module_name:
                module_id = _stable_node_id(repo_id, "<external>", module_name, "module")
                existing_ids = {n["id"] for n in nodes}
                if module_id not in existing_ids:
                    nodes.append({
                        "id": module_id,
                        "type": "module",
                        "name": module_name,
                        "path": "<external>",
                        "code_snippet": "",
                    })
                edges.append((file_node_id, module_id, "imports"))

        # Call expression nodes → calls edge
        if call_type and ts_type == call_type:
            func_node = node.child_by_field_name("function")
            if func_node is None and node.children:
                func_node = node.children[0]
            if func_node is not None:
                call_name = _node_text(func_node, source_bytes).strip().split("(")[0]
                # Only track calls to locally-known symbols to avoid noise
                if call_name in local_symbol_ids:
                    target_id = local_symbol_ids[call_name]
                    # Find closest enclosing definition to use as source
                    ancestor = node.parent
                    source_id = file_node_id
                    while ancestor is not None:
                        ancestor_name = _find_name(ancestor, "name", source_bytes)
                        if ancestor_name and ancestor_name in local_symbol_ids:
                            source_id = local_symbol_ids[ancestor_name]
                            break
                        ancestor = ancestor.parent
                    if source_id != target_id:
                        edges.append((source_id, target_id, "calls"))

        for child in node.children:
            walk(child)

    walk(root)
    return nodes, edges


# ──────────────────────────────────────────────────────────
# Public API (same as before — callers unchanged)
# ──────────────────────────────────────────────────────────
def build_graph_facts(
    repo_id: uuid.UUID,
    repo_dir: Path,
    *,
    max_snippet_chars: int = DEFAULT_MAX_SNIPPET_CHARS,
) -> dict:
    if not repo_dir.exists():
        raise RuntimeError(f"Repo directory not found: {repo_dir}")

    nodes_by_id: dict[str, dict] = {}
    edges_set: set[tuple[str, str, str]] = set()

    for source_file, lang_name in _iter_source_files(repo_dir):
        rel_path = _relative_posix(source_file, repo_dir)
        try:
            source_bytes = source_file.read_bytes()
        except OSError:
            continue

        file_nodes, file_edges = _extract_facts_treesitter(
            source_bytes, lang_name, rel_path, repo_id, max_snippet_chars
        )
        for node in file_nodes:
            nodes_by_id.setdefault(node["id"], node)
        for edge in file_edges:
            edges_set.add(edge)

    nodes = sorted(nodes_by_id.values(), key=lambda n: n["id"])
    edges = [
        {"source": src, "target": tgt, "type": etype}
        for src, tgt, etype in sorted(edges_set)
    ]
    return {
        "repo_id": str(repo_id),
        "nodes": nodes,
        "edges": edges,
    }


def write_graph_facts(
    repo_id: uuid.UUID,
    repo_dir: Path,
    *,
    artifacts_root: Path,
    max_snippet_chars: int = DEFAULT_MAX_SNIPPET_CHARS,
) -> Path:
    facts = build_graph_facts(repo_id, repo_dir, max_snippet_chars=max_snippet_chars)
    output_dir = artifacts_root / str(repo_id)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "graph_facts.json"
    output_path.write_text(json.dumps(facts, indent=2), encoding="utf-8")
    return output_path
