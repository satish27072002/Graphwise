"""
Tests for the tree-sitter Python parser (services/parser/).
Covers:
  - File discovery (find_python_files)
  - Function extraction (name, docstring, start/end line, complexity)
  - Class extraction (name, methods, docstring)
  - Import detection (internal vs external)
  - Call relationship extraction (caller -> callee, line_number)
"""

import sys
import os
import tempfile
import textwrap
from pathlib import Path

import pytest

# Add backend to path so we can import without installing
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


# ─── Fixtures ─────────────────────────────────────────────────────────────────

SIMPLE_MODULE = textwrap.dedent("""\
    \"\"\"A simple module for testing.\"\"\"

    import os
    import requests
    from . import utils

    class MyClass:
        \"\"\"A sample class.\"\"\"

        def method_a(self):
            \"\"\"Does something.\"\"\"
            return 1

        def method_b(self):
            x = self.method_a()
            return x + 1

    def standalone_func(x: int) -> int:
        \"\"\"A standalone function.\"\"\"
        if x > 0:
            return helper(x)
        return 0

    def helper(n):
        return n * 2
""")

COMPLEX_MODULE = textwrap.dedent("""\
    def complex_func(a, b, c):
        if a:
            if b:
                return 1
            elif c:
                return 2
            else:
                return 3
        elif b and c:
            return 4
        for i in range(10):
            if i % 2 == 0:
                pass
        return 0
""")


@pytest.fixture
def simple_py_file(tmp_path):
    """Write SIMPLE_MODULE to a temp .py file and return the path."""
    f = tmp_path / "sample.py"
    f.write_text(SIMPLE_MODULE)
    return f


@pytest.fixture
def simple_repo(tmp_path):
    """Create a small fake repo with multiple .py files."""
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "__init__.py").write_text("")
    (tmp_path / "pkg" / "app.py").write_text(SIMPLE_MODULE)
    (tmp_path / "pkg" / "__pycache__").mkdir()
    (tmp_path / "pkg" / "__pycache__" / "app.cpython-311.pyc").write_bytes(b"fake")
    (tmp_path / ".venv").mkdir()
    (tmp_path / ".venv" / "lib.py").write_text("# venv file")
    return tmp_path


# ─── find_python_files ────────────────────────────────────────────────────────

class TestFindPythonFiles:
    def test_finds_py_files(self, simple_repo):
        """Should find all .py files recursively under a directory."""
        from services.parser.python_parser import find_python_files
        found = list(find_python_files(str(simple_repo)))
        py_names = [Path(p).name for p in found]
        assert "__init__.py" in py_names
        assert "app.py" in py_names

    def test_skips_pycache(self, simple_repo):
        """Should skip __pycache__ directories."""
        from services.parser.python_parser import find_python_files
        found = list(find_python_files(str(simple_repo)))
        for path in found:
            assert "__pycache__" not in path

    def test_skips_venv(self, simple_repo):
        """Should skip .venv directories."""
        from services.parser.python_parser import find_python_files
        found = list(find_python_files(str(simple_repo)))
        for path in found:
            assert ".venv" not in path


# ─── AST extraction ───────────────────────────────────────────────────────────

class TestAstExtractor:
    def test_extracts_function_names(self, simple_py_file):
        """Should extract all top-level and method function names."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        func_names = [f.name for f in result.functions]
        assert "standalone_func" in func_names
        assert "helper" in func_names

    def test_extracts_method_names(self, simple_py_file):
        """Should extract class methods."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        func_names = [f.name for f in result.functions]
        assert "method_a" in func_names
        assert "method_b" in func_names

    def test_extracts_function_docstring(self, simple_py_file):
        """Should capture docstring text for functions that have one."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        standalone = next((f for f in result.functions if f.name == "standalone_func"), None)
        assert standalone is not None
        assert standalone.docstring and "standalone" in standalone.docstring.lower()

    def test_extracts_function_line_range(self, simple_py_file):
        """Should correctly record start_line and end_line for functions."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        standalone = next((f for f in result.functions if f.name == "standalone_func"), None)
        assert standalone is not None
        assert standalone.start_line > 0
        assert standalone.end_line >= standalone.start_line

    def test_extracts_class_names(self, simple_py_file):
        """Should extract all class names from a .py file."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        class_names = [c.name for c in result.classes]
        assert "MyClass" in class_names

    def test_extracts_class_methods(self, simple_py_file):
        """Should list all method names belonging to a class."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        my_class = next((c for c in result.classes if c.name == "MyClass"), None)
        assert my_class is not None
        assert "method_a" in my_class.methods
        assert "method_b" in my_class.methods

    def test_detects_external_imports(self, simple_py_file):
        """Should classify third-party imports as 'external'."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        external_names = [i.name for i in result.imports if i.import_type == "external"]
        assert "requests" in external_names

    def test_detects_internal_imports(self, simple_py_file):
        """Should classify relative imports as 'internal'."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        internal_names = [i.name for i in result.imports if i.import_type == "internal"]
        assert "utils" in internal_names

    def test_extracts_call_relationships(self, simple_py_file):
        """Should detect direct function calls and record line numbers."""
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(simple_py_file))
        caller_names = [c.caller for c in result.calls]
        assert "standalone_func" in caller_names
        # standalone_func calls helper
        helper_calls = [c for c in result.calls if c.callee == "helper"]
        assert len(helper_calls) > 0

    def test_cyclomatic_complexity(self, tmp_path):
        """Complex function with branches should have higher complexity."""
        f = tmp_path / "complex.py"
        f.write_text(COMPLEX_MODULE)
        from services.parser.ast_extractor import extract_from_file
        result = extract_from_file(str(f))
        complex_fn = next((fn for fn in result.functions if fn.name == "complex_func"), None)
        assert complex_fn is not None
        # Should have complexity > 1 (multiple branches)
        assert complex_fn.complexity > 1
