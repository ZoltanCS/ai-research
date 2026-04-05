"""Model listing and provider health-check endpoints."""

from fastapi import APIRouter, Request

from models.schemas import AllModelsResponse, ModelInfoOut, ProvidersStatusResponse, ProviderStatusOut
from services.ai_provider import Provider, ProviderCredentials, get_provider_status, list_all_models

router = APIRouter()


def _creds(req: Request) -> ProviderCredentials:
    """Extract provider credentials from custom request headers."""
    return ProviderCredentials(
        openai_key=req.headers.get("X-OpenAI-Key", ""),
        anthropic_key=req.headers.get("X-Anthropic-Key", ""),
        cerebras_key=req.headers.get("X-Cerebras-Key", ""),
        vercel_token=req.headers.get("X-Vercel-Token", ""),
        vercel_gateway_url=req.headers.get("X-Vercel-Gateway", ""),
        ollama_host=req.headers.get("X-Ollama-Host", ""),
    )


@router.get("/models", response_model=AllModelsResponse)
async def get_all_models(request: Request):
    """Return available models grouped by provider.

    Ollama models are fetched live from the daemon; cloud provider lists are
    fetched live when an API key header is present, otherwise fall back to
    static defaults.
    """
    all_models = await list_all_models(_creds(request))

    def _convert(models):
        return [
            ModelInfoOut(
                id=m.id,
                name=m.name,
                provider=m.provider,
                context_length=m.context_length,
            )
            for m in models
        ]

    return AllModelsResponse(
        ollama=_convert(all_models[Provider.OLLAMA]),
        openai=_convert(all_models[Provider.OPENAI]),
        anthropic=_convert(all_models[Provider.ANTHROPIC]),
        cerebras=_convert(all_models[Provider.CEREBRAS]),
        vercel=_convert(all_models[Provider.VERCEL]),
    )


@router.get("/providers/status", response_model=ProvidersStatusResponse)
async def get_providers_status(request: Request):
    """Check connectivity / configuration for all providers.

    Status values:
    - ``ok``           — provider is reachable and the API key is valid
    - ``error``        — provider is reachable but authentication failed or
                         an unexpected error occurred
    - ``unconfigured`` — required API key is not set (env or header)
    """
    statuses = await get_provider_status(_creds(request))

    def _to_schema(raw: dict) -> ProviderStatusOut:
        return ProviderStatusOut(
            status=raw["status"],
            detail=raw.get("detail"),
            host=raw.get("host"),
            model_count=raw.get("model_count"),
        )

    return ProvidersStatusResponse(
        ollama=_to_schema(statuses[Provider.OLLAMA]),
        openai=_to_schema(statuses[Provider.OPENAI]),
        anthropic=_to_schema(statuses[Provider.ANTHROPIC]),
        cerebras=_to_schema(statuses[Provider.CEREBRAS]),
        vercel=_to_schema(statuses[Provider.VERCEL]),
    )
