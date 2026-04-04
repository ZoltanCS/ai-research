from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "LocalMind"
    app_env: str = "development"
    secret_key: str = "change-me-in-production"

    # Database
    database_url: str = "postgresql+asyncpg://localmind:localmind@localhost:5432/localmind"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # LLM providers
    llm_provider: str = "ollama"  # ollama | openai | anthropic

    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-4-6"

    # ── Embeddings ────────────────────────────────────────────────────────────
    # "ollama" uses nomic-embed-text; "openai" uses text-embedding-3-small
    embedding_provider: str = "ollama"     # ollama | openai
    embedding_model: str = "nomic-embed-text"
    openai_embedding_model: str = "text-embedding-3-small"
    # Both providers are normalised to this dimension.
    # OpenAI supports the `dimensions` param; Ollama nomic-embed-text is 768.
    embedding_dimensions: int = 768

    # ── Document chunking ─────────────────────────────────────────────────────
    chunk_size_tokens: int = 512       # target chunk size in tokens
    chunk_overlap_tokens: int = 50     # overlap between consecutive chunks
    # Legacy character-based settings kept for backwards-compat
    chunk_size: int = 1000
    chunk_overlap: int = 200

    # ── RAG retrieval ─────────────────────────────────────────────────────────
    rag_top_k: int = 6                 # chunks to retrieve
    rag_hybrid_alpha: float = 0.7      # weight for semantic vs keyword (1.0 = pure semantic)
    max_context_docs: int = 5          # legacy alias

    # ── Web search ────────────────────────────────────────────────────────────
    tavily_api_key: str = ""
    searxng_host: str = ""             # e.g. http://localhost:8080
    web_search_timeout: int = 15       # seconds per HTTP request
    web_scrape_max_chars: int = 3000   # max chars to keep from scraped page
    web_cache_ttl: int = 3600          # Redis TTL for search results (seconds)

    # ── CORS ──────────────────────────────────────────────────────────────────
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]


settings = Settings()
