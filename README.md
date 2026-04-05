# LocalMind

**An open-source local AI research and chat application.**  
Run powerful AI models on your own hardware — or connect to OpenAI / Anthropic — with built-in RAG, autonomous deep research, and self-hosted web search.

```
  _                 _ __  __ _           _
 | |    ___   ___ __ _| |  \/  (_)_ _  __| |
 | |__ / _ \ / __/ _` | | |\/| | | ' \/ _` |
 |____|\___/ \___\__,_|_|_|  |_|_|_||_\__,_|
```

[![CI](https://github.com/zoltancs/ai-research/actions/workflows/ci.yml/badge.svg)](https://github.com/zoltancs/ai-research/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)

---

> **Screenshot placeholder** — add `docs/screenshot.png` and uncomment below  
> `![LocalMind UI](docs/screenshot.png)`

---

## ✨ Features

### 🧠 Multi-provider AI
- **Ollama** — run Llama 3.2, Mistral, Gemma and any local model with zero data leaving your machine
- **OpenAI** — GPT-4o, GPT-4o Mini
- **Anthropic** — Claude Opus / Sonnet / Haiku with adaptive extended thinking
- Switch models per conversation from the topbar model selector

### 📄 RAG (Retrieval-Augmented Generation)
- Upload **PDF, DOCX, TXT, MD** documents — up to 50 MB each
- Token-aware chunking (512 tokens, 50-token overlap) via tiktoken
- Dual embedding: Ollama `nomic-embed-text` or OpenAI `text-embedding-3-small` (both normalised to 768 dims)
- **Hybrid search** — cosine similarity + BM25 keyword search fused via Reciprocal Rank Fusion (RRF)
- pgvector IVFFlat index for fast approximate nearest-neighbour retrieval
- SHA-256 deduplication — re-uploading identical files returns the existing record instantly

### 🔬 Deep Research Agent
- Autonomous 4-step pipeline:
  1. **Decompose** — LLM breaks query into focused sub-questions (multi-strategy JSON parsing)
  2. **Search** — parallel web searches for all sub-questions via `asyncio.gather`
  3. **Read** — concurrent content extraction from top-k deduplicated URLs
  4. **Synthesise** — LLM streams a structured markdown report with source attribution
- Real-time animated stepper + colour-coded activity log
- Auto-generated table of contents from `##` headings
- Export: copy markdown, download `.md`, print / save as PDF
- Reports persisted to PostgreSQL with source metadata

### 🌐 Web Search
- **Tavily** (cloud, high-quality) — set `TAVILY_API_KEY` in `.env`
- **SearXNG** self-hosted fallback — bundled in `docker-compose.yml`, no API key needed
- Redis caching (1-hour TTL) keyed by SHA-256 query hash

### 💬 Streaming Chat
- Server-Sent Events (SSE) for token-by-token streaming
- Conversation history persisted to PostgreSQL
- `react-markdown` + `rehype-highlight` rendering (Atom One Dark theme)
- Source citation chips below assistant messages
- Collapsible system prompt editor
- Attach documents directly in chat → auto-enables RAG

### ⚙️ Settings & Customisation
- Dark / light theme with no-flash switching (blocking script reads localStorage)
- Per-task default model selection (chat, research)
- Provider status indicators (live health checks)
- One-click data management: clear conversations, clear documents

---

## Architecture

```
                         LocalMind Architecture
┌──────────────────────────────────────────────────────────────┐
│                       Browser / Client                        │
│             Next.js 14 App Router  ·  Zustand store           │
│      Chat  │  Documents  │  Research  │  Settings             │
└──────────────────────────┬───────────────────────────────────┘
                           │  REST / SSE
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                       FastAPI Backend                         │
│                                                               │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────────────┐  │
│  │   Chat   │  │  Documents │  │     Deep Research        │  │
│  │  Router  │  │   Router   │  │        Agent             │  │
│  └────┬─────┘  └─────┬──────┘  └────────────┬─────────────┘  │
│       └──────────────┼──────────────────────┘                │
│                      ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              AI Provider Service                         │ │
│  │   Ollama (local) · OpenAI (cloud) · Anthropic (cloud)    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                      RAG Pipeline                        │ │
│  │   Ingest → Chunk (tiktoken) → Embed → pgvector store     │ │
│  │       Hybrid Search: cosine sim + BM25 via RRF           │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────┬────────────────┬──────────────────┬──────────────┘
            │                │                  │
            ▼                ▼                  ▼
     ┌────────────┐   ┌──────────┐   ┌──────────────────┐
     │ PostgreSQL │   │  Redis   │   │     SearXNG      │
     │ + pgvector │   │  cache   │   │   web search     │
     └────────────┘   └──────────┘   └──────────────────┘
            ▲
  Ollama (on host machine)
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Docker + Compose](https://docs.docker.com/get-docker/) | ≥ 24 | Required |
| [Ollama](https://ollama.com) | Latest | For local AI models |
| Node.js | ≥ 20 | Local dev only |
| Python | ≥ 3.12 | Local dev only |

### 1 — Clone

```bash
git clone https://github.com/zoltancs/ai-research.git
cd ai-research
```

### 2 — Configure

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```bash
OLLAMA_MODEL=llama3.2          # any model you have pulled in Ollama
# Optional — for cloud providers:
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...        # for higher-quality web search
# Security — change these in production:
SEARXNG_SECRET_KEY=your-random-secret
SECRET_KEY=your-app-secret
```

### 3 — Start

```bash
docker compose up -d
```

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:8000 |
| **API Docs** | http://localhost:8000/docs |
| **SearXNG** | http://localhost:8080 |

### 4 — Pull Ollama models

```bash
ollama pull llama3.2           # chat model
ollama pull nomic-embed-text   # required for document RAG with Ollama embeddings
```

> **Linux note:** Ollama runs on your host. Set `OLLAMA_HOST=http://172.17.0.1:11434` in `.env`  
> (the default `host.docker.internal` works on Docker Desktop for Mac/Windows).

---

## Local Development (without Docker)

### Backend

```bash
cd backend
cp ../.env.example .env        # edit DATABASE_URL/REDIS_URL to point to local services
uv sync
uv run uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
pnpm install
NEXT_PUBLIC_API_URL=http://localhost:8000 pnpm dev
```

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.2` | Default Ollama model |
| `OPENAI_API_KEY` | — | GPT-4o / GPT-4o Mini |
| `ANTHROPIC_API_KEY` | — | Claude Opus / Sonnet / Haiku |
| `TAVILY_API_KEY` | — | Cloud web search (optional) |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` or `openai` |
| `EMBEDDING_DIMENSIONS` | `768` | Vector dimensions |
| `RAG_TOP_K` | `6` | Chunks retrieved per query |
| `RAG_HYBRID_ALPHA` | `0.7` | Semantic vs keyword weight (0–1) |
| `SEARXNG_HOST` | `http://localhost:8080` | SearXNG endpoint |
| `SEARXNG_SECRET_KEY` | — | **Change in production** |
| `SECRET_KEY` | — | **Change in production** |

---

## Project Structure

```
ai-research/
├── frontend/                    # Next.js 14 (App Router)
│   ├── app/
│   │   ├── chat/                # Streaming chat interface
│   │   ├── documents/           # Document upload & RAG
│   │   ├── research/            # Deep research agent
│   │   └── settings/            # Provider config + theme
│   ├── components/
│   │   ├── chat/                # ChatInterface, MessageBubble, InputArea
│   │   ├── documents/           # Dropzone, preview panel
│   │   ├── research/            # Stepper, log, TOC, report
│   │   ├── settings/            # Provider status, model defaults
│   │   └── layout/              # Sidebar, TopBar, ModelSelector
│   ├── lib/api.ts               # Typed API client (SSE + REST)
│   └── store/index.ts           # Zustand global state
│
├── backend/                     # FastAPI (Python 3.12)
│   ├── routers/                 # HTTP handlers
│   ├── services/
│   │   ├── ai_provider.py       # Ollama / OpenAI / Anthropic streaming
│   │   ├── document_service.py  # Ingest, chunk, embed
│   │   ├── rag_service.py       # Hybrid RRF retrieval
│   │   ├── web_search.py        # Tavily + SearXNG + Redis cache
│   │   └── research_agent.py    # 4-step autonomous research
│   ├── models/                  # SQLAlchemy ORM + Pydantic v2 schemas
│   └── core/                    # Settings, async DB session
│
├── searxng/settings.yml         # SearXNG configuration
├── docker-compose.yml
└── .env.example
```

---

## Contributing

Contributions are very welcome! Here's how:

1. **Fork** and clone the repo
2. **Create a branch**: `git checkout -b feat/your-feature`
3. **Make changes** following existing code style
4. **Run the CI checks locally**:
   ```bash
   # Backend
   cd backend && uv run ruff check . && uv run ruff format --check .

   # Frontend
   cd frontend && pnpm lint && pnpm exec tsc --noEmit
   ```
5. **Commit** with [Conventional Commits](https://www.conventionalcommits.org/):  
   `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
6. **Open a Pull Request** — CI will run automatically

### Reporting Issues

Use [GitHub Issues](https://github.com/zoltancs/ai-research/issues). Include:
- Steps to reproduce
- Expected vs actual behaviour
- Relevant logs (`docker compose logs backend`)

---

## License

MIT — see [LICENSE](LICENSE) for details.
