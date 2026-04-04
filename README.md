# LocalMind

A full-stack open-source local AI research and chat application. Run powerful AI models locally or connect to cloud providers — all with RAG-powered document search, web research, and a clean chat interface.

## Features

- **Multi-provider LLM support**: Ollama (local), OpenAI, Anthropic
- **RAG (Retrieval-Augmented Generation)**: Upload documents and chat with them
- **Web research**: Tavily-powered web search integrated into chat
- **Vector search**: pgvector-backed semantic search
- **Streaming responses**: Real-time token streaming
- **Conversation history**: Persistent chat history in PostgreSQL

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Python FastAPI (async) |
| Database | PostgreSQL 16 + pgvector |
| Cache | Redis 7 |
| Package managers | pnpm (frontend), uv (backend) |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js 20+](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [Python 3.12+](https://www.python.org/) and [uv](https://docs.astral.sh/uv/)
- [Ollama](https://ollama.ai/) (for local models)

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/youruser/localmind.git
cd localmind
cp .env.example .env
# Edit .env with your settings
```

### 2. Pull a local model (optional)

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

### 3. Start with Docker Compose

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000).

---

## Development Setup

### Backend

```bash
cd backend
uv sync
uv run alembic upgrade head    # run migrations
uv run uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

### Database only (for local dev)

```bash
docker compose up postgres redis -d
```

---

## Project Structure

```
localmind/
├── frontend/                  # Next.js 14 app
│   ├── app/                   # App Router pages
│   │   ├── chat/              # Chat interface
│   │   └── research/          # Research panel
│   ├── components/
│   │   ├── chat/              # Chat components
│   │   ├── layout/            # Sidebar, navbar
│   │   └── ui/                # shadcn/ui primitives
│   └── lib/                   # API client, utilities
│
├── backend/                   # FastAPI application
│   ├── routers/               # API route handlers
│   │   ├── chat.py            # /api/chat
│   │   ├── documents.py       # /api/documents
│   │   └── research.py        # /api/research
│   ├── services/
│   │   ├── llm.py             # LLM provider abstraction
│   │   ├── rag.py             # RAG pipeline
│   │   └── search.py          # Tavily web search
│   ├── models/
│   │   ├── database.py        # SQLAlchemy ORM models
│   │   └── schemas.py         # Pydantic request/response schemas
│   ├── core/
│   │   ├── config.py          # Settings (pydantic-settings)
│   │   └── database.py        # Async DB session factory
│   └── main.py                # App entry point
│
├── docker-compose.yml
├── .env.example
└── README.md
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `OLLAMA_HOST` | For local LLM | Ollama server URL |
| `OPENAI_API_KEY` | For OpenAI | OpenAI API key |
| `ANTHROPIC_API_KEY` | For Anthropic | Anthropic API key |
| `TAVILY_API_KEY` | For web search | Tavily API key |
| `LLM_PROVIDER` | Yes | `ollama` \| `openai` \| `anthropic` |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Send a chat message (streaming) |
| `GET` | `/api/chat/conversations` | List conversations |
| `GET` | `/api/chat/conversations/{id}` | Get conversation messages |
| `POST` | `/api/documents/upload` | Upload a document |
| `GET` | `/api/documents` | List documents |
| `DELETE` | `/api/documents/{id}` | Delete a document |
| `POST` | `/api/research/search` | Web search via Tavily |
| `GET` | `/api/health` | Health check |

## License

MIT
