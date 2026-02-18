# CodeGraph Navigator

A Graph RAG system that helps developers understand large codebases by combining
semantic vector search with relationship-aware graph traversal.

---

## Project Overview

**What it does**: Developer points the system at a codebase (local folder or GitHub repo).
The system parses it, builds a knowledge graph in Neo4j, and lets developers ask natural
language questions like:
- "How does authentication work?"
- "What breaks if I change User.save()?"
- "Show me all database queries in the payment flow"
- "What does UserService depend on?"

**How it works**: Every query goes through this pipeline:
1. Embed the question (OpenAI text-embedding-3-small)
2. Hybrid search in Neo4j (vector + full-text combined)
3. Graph expansion — traverse CALLS/IMPORTS/INHERITS relationships from results
4. text2Cypher — for structural questions, generate a Cypher query with gpt-4o
5. Assemble context and call gpt-4o for the final answer
6. Return answer + graph data (nodes + edges) to the frontend

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript |
| UI Components | shadcn/ui + Tailwind CSS |
| Graph Visualization | React Flow |
| Backend API | FastAPI (Python) |
| Database | Neo4j (graph + vector index + full-text index) |
| Code Parser | tree-sitter (Python AST extraction) |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| LLM | OpenAI gpt-4o (generation + text2Cypher) |
| Containerization | Docker Compose (two configs: local + deploy) |

**No LangChain.** All LLM and Neo4j calls are made directly via their SDKs.
This is intentional — full control and transparency over the pipeline.

---

## Repository Structure

```
codegraph-navigator/
├── CLAUDE.md
├── docker-compose.local.yml
├── docker-compose.deploy.yml
├── .env.example
├── .gitignore
├── README.md
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                    # shadcn/ui auto-generated components
│   │   ├── SearchBar.tsx
│   │   ├── AnswerPanel.tsx
│   │   ├── GraphCanvas.tsx        # React Flow canvas
│   │   ├── NodeTypes/
│   │   │   ├── FunctionNode.tsx
│   │   │   ├── ClassNode.tsx
│   │   │   ├── FileNode.tsx
│   │   │   └── ModuleNode.tsx
│   │   ├── EdgeTypes/
│   │   │   ├── CallsEdge.tsx
│   │   │   ├── ImportsEdge.tsx
│   │   │   └── InheritsEdge.tsx
│   │   └── CodeSnippet.tsx
│   ├── lib/
│   │   └── api.ts
│   ├── types/
│   │   └── index.ts
│   ├── tailwind.config.ts
│   ├── components.json
│   ├── next.config.ts
│   └── package.json
│
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── routers/
│   │   ├── query.py               # POST /query
│   │   ├── ingest.py              # POST /ingest
│   │   └── graph.py               # GET /graph/{node_id}
│   ├── services/
│   │   ├── parser/
│   │   │   ├── python_parser.py
│   │   │   └── ast_extractor.py
│   │   ├── graph/
│   │   │   ├── builder.py
│   │   │   └── neo4j_loader.py
│   │   ├── embeddings/
│   │   │   └── embedder.py
│   │   ├── retrieval/
│   │   │   ├── hybrid_retriever.py
│   │   │   ├── graph_expander.py
│   │   │   ├── text2cypher.py
│   │   │   └── parent_retriever.py
│   │   └── llm/
│   │       ├── query_engine.py
│   │       └── prompts.py
│   ├── db/
│   │   └── neo4j_client.py
│   ├── models/
│   │   └── schemas.py
│   ├── requirements.txt
│   └── Dockerfile
│
├── evals/
│   ├── benchmark.py
│   └── test_cases.json
│
└── tests/
    ├── test_parser.py
    ├── test_retrieval.py
    └── test_text2cypher.py
```

---

## Neo4j Data Model

### Node Labels and Properties

```
Function: name, file, start_line, end_line, docstring, code, complexity, loc, embedding[]
Class:    name, file, start_line, end_line, docstring, methods[]
File:     path, language, loc
Module:   name, type (internal | external)
Chunk:    text, embedding[], index, parent_id
```

### Relationship Types

```
(File)-[:CONTAINS]->(Function)
(File)-[:CONTAINS]->(Class)
(Class)-[:HAS_METHOD]->(Function)
(Function)-[:CALLS {line_number}]->(Function)
(Function)-[:IMPORTS]->(Module)
(Class)-[:INHERITS]->(Class)
(Chunk)-[:HAS_PARENT]->(Chunk)
(Chunk)-[:HAS_CHILD]->(Chunk)
```

### Required Neo4j Indexes

```cypher
CREATE VECTOR INDEX function_embeddings IF NOT EXISTS
FOR (f:Function) ON f.embedding
OPTIONS {indexConfig: {`vector.dimensions`: 1536, `vector.similarity_function`: 'cosine'}}

CREATE FULLTEXT INDEX function_text IF NOT EXISTS
FOR (f:Function) ON EACH [f.name, f.docstring, f.code]

CREATE VECTOR INDEX chunk_embeddings IF NOT EXISTS
FOR (c:Chunk) ON c.embedding
OPTIONS {indexConfig: {`vector.dimensions`: 1536, `vector.similarity_function`: 'cosine'}}
```

---

## API Contract

### POST /query
```json
Request:
{
  "question": string,
  "codebase_id": string,
  "top_k": int,
  "hops": int
}

Response:
{
  "answer": string,
  "sources": [
    { "name": string, "file": string, "start_line": int,
      "end_line": int, "code": string, "relevance_score": float }
  ],
  "graph": {
    "nodes": [
      { "id": string, "type": "Function"|"Class"|"File"|"Module",
        "name": string, "file": string, "highlighted": boolean }
    ],
    "edges": [
      { "id": string, "source": string, "target": string,
        "type": "CALLS"|"IMPORTS"|"INHERITS"|"CONTAINS"|"HAS_METHOD" }
    ]
  },
  "retrieval_method": string,
  "cypher_used": string | null
}
```

### POST /ingest
```json
Request:  { "repo_path": string, "codebase_id": string, "language": "python" }
Response: { "status": string, "nodes_created": int, "relationships_created": int }
```

### GET /graph/{node_id}
```json
Response: { "nodes": [...], "edges": [...] }
```

---

## Environment Variables

See `.env.example`. Never commit `.env`.

```bash
OPENAI_API_KEY=           # OpenAI API key from platform.openai.com
NEO4J_URI=                # bolt://localhost:7687 (local) | bolt://neo4j:7687 (docker)
NEO4J_USER=               # neo4j
NEO4J_PASSWORD=           # strong password, min 8 chars
NEXT_PUBLIC_API_URL=      # http://localhost:8000 (local) | http://VM_IP:8000 (deploy)
```

---

## Docker Compose Setup

**Local** (`docker-compose.local.yml`):
- Source code mounted as volumes for hot reload
- Ports: Neo4j 7474/7687, FastAPI 8000, Next.js 3000

**Deploy** (`docker-compose.deploy.yml`):
- No volume mounts — runs from built images
- `NEXT_PUBLIC_API_URL` must point to the Azure VM's public IP

```bash
# Local development
docker compose -f docker-compose.local.yml up

# Azure VM (after git pull and filling .env)
docker compose -f docker-compose.deploy.yml up -d
```

---

## Development Commands

```bash
# Backend (without Docker)
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (without Docker)
cd frontend
npm install
npm run dev                    # localhost:3000

# Full stack with Docker
docker compose -f docker-compose.local.yml up --build

# Tests
cd backend && pytest tests/

# Neo4j Browser (when running)
open http://localhost:7474
```

---

## UI/UX Design System

This is the most important section for building the frontend.
Follow every detail precisely. Do not deviate toward generic patterns.

### Aesthetic Direction

**Dark, precise, developer-native.** Think Linear, Vercel dashboard, or Warp terminal.
Not a consumer app. Not purple gradients. Not rounded pastel cards.
The user is a developer — the interface must feel like it was built by developers, for developers.
Sharp edges. Monospace where code lives. Luminous accents on near-black backgrounds.
Every element earns its place on screen.

---

### Color System

Define all colors as CSS variables in `globals.css`:

```css
:root {
  /* Base surfaces */
  --bg-base:        #080808;   /* page background */
  --bg-surface:     #111111;   /* card / panel background */
  --bg-elevated:    #1a1a1a;   /* hover states, dropdowns */
  --bg-border:      #222222;   /* borders, dividers */

  /* Text */
  --text-primary:   #f0f0f0;
  --text-secondary: #888888;
  --text-muted:     #444444;

  /* Node type accent colors */
  --accent-function: #3b82f6;  /* blue    — Function nodes */
  --accent-class:    #f59e0b;  /* amber   — Class nodes */
  --accent-file:     #10b981;  /* emerald — File nodes */
  --accent-module:   #8b5cf6;  /* violet  — Module nodes */

  /* Edge type colors */
  --edge-calls:    #60a5fa;    /* light blue */
  --edge-imports:  #fb923c;    /* orange */
  --edge-inherits: #a78bfa;    /* purple */
  --edge-contains: #4b5563;    /* gray — subtle, structural */

  /* Interactive states */
  --accent-primary:  #3b82f6;
  --accent-hover:    #60a5fa;
  --highlight-glow:  rgba(59, 130, 246, 0.15);
}
```

---

### Typography

```css
/* In globals.css */
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap');

body {
  font-family: 'Geist', sans-serif;
  background: var(--bg-base);
  color: var(--text-primary);
}

code, pre, .monospace {
  font-family: 'Geist Mono', monospace;
}
```

Geist (by Vercel) for all UI text — clean, technical, designed for developer tools.
Geist Mono for all code, function names, file paths, and line numbers.

---

### Layout — Two States

**State 1: Empty / Search (first load)**

Full-screen centered layout. No sidebar. The search bar is the hero.

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                                                         │
│              CodeGraph Navigator                        │
│         Understand any codebase instantly               │
│                                                         │
│   ┌─────────────────────────────────────────────┐      │
│   │  ⌘  Ask anything about your codebase...    │      │
│   └─────────────────────────────────────────────┘      │
│                                                         │
│   Try:  "How does auth work?"                           │
│         "What calls process_payment()?"                 │
│         "What breaks if I change User.save()?"          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**State 2: Results (after a query)**

Three-panel layout. Animate the transition from State 1 smoothly.

```
┌──────────────────────────────────────────────────────────────┐
│  CodeGraph Navigator          [codebase: flask]  [+ Ingest]  │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ⌘  What breaks if I change User.save()?            │   │
│  └──────────────────────────────────────────────────────┘   │
├────────────────────────┬─────────────────────────────────────┤
│  ANSWER          (38%) │  GRAPH CANVAS (62%)  — React Flow   │
│  ─────────────────     │  ─────────────────────────────────  │
│                        │                                     │
│  Changing User.save()  │   [interactive node-edge graph]     │
│  directly impacts 3    │                                     │
│  callers:              │   Function ● ──calls──▶ ● Function  │
│                        │   Class    ◆            ◆ Class     │
│  • create_user()       │                                     │
│    user_controller.py  │   [minimap bottom-right]            │
│    line 45             │   [controls bottom-left]            │
│                        │   [edge filter pills top]           │
│  • update_profile()    │                                     │
│    profile_ctrl.py:89  │                                     │
│                        │                                     │
├────────────────────────┴─────────────────────────────────────┤
│  CODE REFERENCES  (fixed height, scrollable)                 │
│  ────────────────────────────────────────────────────────    │
│  ● User.save()       models.py:156      ████████░░  0.97    │
│  ● create_user()     controllers.py:45  ███████░░░  0.89    │
└──────────────────────────────────────────────────────────────┘
```

---

### React Flow — Graph Canvas

#### Custom Node Components

Each node type is a fully custom React component registered with React Flow.
Never use the default React Flow node style.

**FunctionNode.tsx:**
```
┌─────────────────────────────┐
│ ▌  authenticate_user        │  ← 3px blue left border (--accent-function)
│    auth.py : 45             │  ← Geist Mono, --text-secondary
│    complexity: 8            │  ← small muted badge
└─────────────────────────────┘
```

**ClassNode.tsx:**
```
┌─────────────────────────────┐
│ ◆  UserService              │  ← 3px amber left border (--accent-class)
│    services/user.py         │
│    4 methods                │
└─────────────────────────────┘
```

**FileNode.tsx:**
```
┌─────────────────────────────┐
│ ▣  auth.py                  │  ← 3px emerald left border (--accent-file)
│    450 lines · Python       │
└─────────────────────────────┘
```

**ModuleNode.tsx:**
```
┌─────────────────────────────┐
│ ○  bcrypt                   │  ← 3px violet left border (--accent-module)
│    external                 │
└─────────────────────────────┘
```

Node base styles:
- Background: `var(--bg-surface)`
- Border: 1px solid `var(--bg-border)`
- Left border: 3px solid `var(--accent-{type})`
- Border radius: 6px
- Padding: 10px 14px
- Min width: 200px
- Name in Geist Mono, 13px, `--text-primary`
- File path and metadata in Geist Mono, 11px, `--text-secondary`

**Highlighted nodes** (returned as `highlighted: true` from API):
- `box-shadow: 0 0 0 1px var(--accent-primary), 0 0 20px var(--highlight-glow)`
- Background: `var(--bg-elevated)`

**Neighbor/context nodes** (`highlighted: false`):
- `opacity: 0.45`
- No glow

#### Custom Edge Components

Never use default React Flow edges.

- `CALLS` edges: animated dashed line, `--edge-calls`, arrowhead at target
  Use CSS `stroke-dasharray` + `stroke-dashoffset` animation to show flow direction
- `IMPORTS` edges: solid line, `--edge-imports`, arrowhead at target
- `INHERITS` edges: solid line, `--edge-inherits`, hollow diamond at source
- `CONTAINS` edges: subtle dotted line, `--edge-contains` — shown only when File nodes visible

Edge labels: invisible by default, appear on hover showing relationship type
and line number if available (e.g. "CALLS · line 67")

#### Canvas Behaviors

- **On query result**: call `useReactFlow().fitView({ nodes: highlightedNodes, padding: 0.2 })`
  to animate camera to the relevant subgraph
- **On node click**: call `GET /graph/{node_id}`, merge new nodes/edges into graph state,
  animate new nodes appearing with fade + scale (0.8 → 1.0, 200ms)
- **Background**: `<Background variant={BackgroundVariant.Dots} color="#1f1f1f" gap={20} size={1} />`
- **Minimap**: always visible, bottom-right, dark themed to match canvas
- **Controls**: zoom in/out/fit — bottom-left
- **Edge filter pills**: row of toggle pills above the canvas, one per edge type
  (CALLS, IMPORTS, INHERITS, CONTAINS). Toggling hides that edge type without removing nodes.
  Active pill: solid accent color. Inactive: muted/dimmed.

---

### Search Bar

The search bar is built on shadcn `Command` component, not a plain `<input>`.

- Full width in the header area after first query
- Background: `var(--bg-surface)`, border: 1px solid `var(--bg-border)`
- On focus: border → `var(--accent-primary)` + subtle outer glow, 150ms transition
- Left: search icon in `--text-muted`
- Right: `⌘K` badge — pressing it from anywhere focuses the search bar
- On submit: bar stays filled with current query
- While loading: border pulses with shimmer animation (not a spinner)
- Placeholder suggestions cycle through example queries when empty

---

### Answer Panel

- Render answer as Markdown using `react-markdown` with `rehype-highlight` (dark theme)
- Numbered steps, bold names, inline code — all render correctly from Markdown
- Below the answer text, a metadata line in `--text-muted` Geist Mono:
  `Retrieved via: hybrid + graph expansion  ·  340ms  ·  5 sources`
- If `cypher_used` is present in the response: show a collapsible
  "View Generated Cypher" section with syntax-highlighted Cypher query
- If answer is loading: show `<Skeleton>` lines matching expected answer length

---

### Code References Panel (Bottom Strip)

Fixed height (~120px), horizontally scrollable if needed.
Each row:

```
● authenticate_user    auth.py : 45–78    ████████░░  0.94    [View ↗]
```

- Colored dot = node type accent color
- Name in Geist Mono, `--text-primary`
- File:line range in Geist Mono, `--text-secondary`
- Relevance bar: filled with `--accent-primary`, background `--bg-border`, width 80px
- "View ↗" opens a `<Sheet>` (shadcn side panel) from the right showing:
  - Full function/class code with syntax highlighting
  - A mini React Flow subgraph showing only that node's immediate neighbors
  - File path, line range, complexity score at the top

---

### Ingest Flow

When user clicks "+ Ingest":
- Slide in a `<Sheet>` from the right (not a blocking modal)
- User enters a local path or GitHub repo URL
- On submit, show a live progress feed:

```
✓  Parsing Python files...            127 files
✓  Extracting functions/classes...    1,843 nodes
✓  Building graph relationships...    4,211 edges
⟳  Generating embeddings...           1,204 / 1,843
○  Loading into Neo4j...
○  Creating indexes...
```

Icons: ✓ green, ⟳ animated blue, ○ muted gray
On completion: close sheet, show success toast (shadcn Sonner)

---

### Animations and Transitions

- Page load: staggered fade-in — header (0ms), search bar (100ms), example queries (200ms)
- State 1 → State 2: answer panel and graph canvas slide up from below with opacity fade,
  300ms ease-out
- New graph nodes: fade in with scale 0.8 → 1.0, 200ms
- Loading shimmer: search bar border pulses, 1.5s loop, stops when response arrives
- Node hover: `transform: scale(1.02)`, 150ms

All animations under 350ms. No passive looping animations on idle UI.
Motion only responds to user actions.

---

### shadcn/ui Components to Use

- `Sheet` — code viewer drawer, ingest panel
- `Command` — search bar base (keyboard shortcut support built in)
- `Badge` — node type labels, relationship type tags
- `Tooltip` — edge labels on hover, complexity score hints
- `Separator` — panel dividers
- `ScrollArea` — code references strip, answer panel
- `Skeleton` — loading states in answer panel
- `Sonner` (Toast) — success/error notifications

Do NOT use `Dialog` or `AlertDialog` for anything. Use `Sheet` instead.
Modals break spatial flow. Side panels preserve context.

---

## Coding Standards

### Python (Backend)
- Python 3.11+
- `async/await` throughout all FastAPI routes and service calls
- Pydantic models for all request/response schemas in `models/schemas.py`
- All Neo4j queries through `db/neo4j_client.py` — never create a driver elsewhere
- All prompts in `services/llm/prompts.py` — never hardcode prompt strings elsewhere
- Type hints on all function signatures
- No LangChain, no LlamaIndex — raw `openai` and `neo4j` SDK calls only
- Parameterized Cypher queries always — never string interpolation

### TypeScript (Frontend)
- Strict TypeScript — no `any` types
- All shared types in `types/index.ts`
- All API calls go through `lib/api.ts` — never call fetch directly in components
- shadcn/ui components in `components/ui/` (auto-generated by CLI)
- Custom components in `components/` (hand-written)
- React Flow graph data consumed directly from API `graph` field — no transformation layer
- Custom node types registered in `GraphCanvas.tsx` via `nodeTypes` object
- Custom edge types registered in `GraphCanvas.tsx` via `edgeTypes` object

### General
- Never commit `.env` — only `.env.example`
- Never commit `node_modules/`, `__pycache__/`, `.next/`
- Atomic commits — one feature or fix per commit

---

## Build Plan (Weeks)

- **Week 1**: Docker Compose setup + tree-sitter parser + Neo4j loader
- **Week 2**: OpenAI embeddings + Neo4j vector/fulltext indexes + hybrid retriever
- **Week 3**: text2Cypher + context assembly + gpt-4o generation (full pipeline)
- **Week 4**: Next.js frontend — full UI as specified in this document
- **Week 5**: Evaluation benchmark, deploy to Azure VM, README + demo video

---

## Key Architectural Decisions

- **Neo4j only** (no ChromaDB) — handles graph, vector, and full-text natively
- **No LangChain** — raw SDK calls for full control and debuggability
- **Standard REST** (no SSE) — sufficient for portfolio, simpler frontend logic
- **Two Docker Compose files** — `local` for development, `deploy` for Azure VM
- **text2Cypher for structural queries** — counts, impact analysis, dependency chains
- **Parent document retrieval** — embed small child chunks, return larger parent context
- **Custom React Flow nodes and edges** — every node type and relationship has its own component

---

## Important Notes for Claude Code

- When creating new FastAPI routes, always add them to the correct router file in `routers/`
- The `graph` field in API responses must always be `{ nodes: [], edges: [] }` — React Flow consumes it directly
- When adding new environment variables, always add them to `.env.example` with a comment
- The embedding model is always `text-embedding-3-small` — never switch mid-project
- When building any frontend component, follow the UI/UX Design System section exactly —
  colors, fonts, layout, node styles, edge styles, and animations are all fully specified
- Run `pytest tests/` after any backend changes before committing
- Never use default React Flow node or edge styles — always use the custom components
