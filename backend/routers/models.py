"""Model listing and provider health-check endpoints."""

from fastapi import APIRouter

from models.schemas import AllModelsResponse, ModelInfoOut, ProvidersStatusResponse, ProviderStatusOut
from services.ai_provider import Provider, get_provider_status, list_all_models

router = APIRouter()


@router.get("/models", response_model=AllModelsResponse)
async def get_all_models():
    """Return available models grouped by provider.

    Ollama models are fetched live from the daemon; cloud provider lists
    are static but reflect the models actually usable with LocalMind.
    """
    all_models = await list_all_models()

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
    )


@router.get("/providers/status", response_model=ProvidersStatusResponse)
async def get_providers_status():
    """Check connectivity / configuration for all three providers.

    Status values:
    - ``ok``           — provider is reachable and the API key is valid
    - ``error``        — provider is reachable but authentication failed or
                         an unexpected error occurred
    - ``unconfigured`` — required API key env var is not set
    """
    statuses = await get_provider_status()

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
    )
