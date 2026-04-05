"""Personality system prompt generation."""
from fastapi import APIRouter, Request
from pydantic import BaseModel
from services.ai_provider import ProviderCredentials, complete_chat

router = APIRouter()


class GeneratePromptRequest(BaseModel):
    description: str
    name: str
    tags: list[str] = []
    provider: str = "openai"
    model: str = "gpt-4o"


class GeneratePromptResponse(BaseModel):
    system_prompt: str


def _creds(req: Request) -> ProviderCredentials:
    return ProviderCredentials(
        openai_key=req.headers.get("X-OpenAI-Key", ""),
        anthropic_key=req.headers.get("X-Anthropic-Key", ""),
        cerebras_key=req.headers.get("X-Cerebras-Key", ""),
        vercel_token=req.headers.get("X-Vercel-Token", ""),
        vercel_gateway_url=req.headers.get("X-Vercel-Gateway", ""),
        ollama_host=req.headers.get("X-Ollama-Host", ""),
        tavily_key=req.headers.get("X-Tavily-Key", ""),
        exa_key=req.headers.get("X-Exa-Key", ""),
    )


@router.post("/generate-prompt", response_model=GeneratePromptResponse)
async def generate_personality_prompt(body: GeneratePromptRequest, request: Request):
    tags_str = ", ".join(body.tags) if body.tags else "none specified"
    user_msg = (
        f"Create a detailed system prompt for an AI personality with these specs:\n"
        f"Name: {body.name}\n"
        f"Description: {body.description}\n"
        f"Style tags: {tags_str}\n\n"
        f"The system prompt should be 3-6 sentences, written in second person ('You are...'), "
        f"defining the AI's personality, communication style, expertise, and approach. "
        f"Make it specific and distinctive. Output ONLY the system prompt text, nothing else."
    )
    result = await complete_chat(
        messages=[{"role": "user", "content": user_msg}],
        model=body.model,
        provider=body.provider,
        creds=_creds(request),
    )
    return GeneratePromptResponse(system_prompt=result.strip())
