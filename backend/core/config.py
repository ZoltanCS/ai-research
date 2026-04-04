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

    # Embeddings
    embedding_model: str = "nomic-embed-text"

    # Web search
    tavily_api_key: str = ""

    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Document processing
    chunk_size: int = 1000
    chunk_overlap: int = 200
    max_context_docs: int = 5


settings = Settings()
