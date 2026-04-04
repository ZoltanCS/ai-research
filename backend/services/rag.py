"""Backward-compatibility shim.

routers/chat.py imports from here; the real implementations live in
services/rag_service.py and services/document_service.py.
"""

from services.document_service import ingest_document  # noqa: F401
from services.rag_service import (  # noqa: F401
    build_rag_prompt,
    retrieve_context,
)
