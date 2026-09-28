"""
ai_service/services/registry.py
===============================
Model registry checker. Enforces that only approved models are served in production.
"""

from typing import Dict, Any, Tuple
from ai_service.config import MODEL_REGISTRY, ModelRegistryEntry


def check_model_approval(model_key: str, allow_unapproved: bool = False) -> Tuple[bool, str]:
    """
    Check if a model is approved for production / integration testing.
    Returns (is_allowed, rejection_reason).
    """
    entry = MODEL_REGISTRY.get(model_key)
    if not entry:
        return False, f"Unknown model key '{model_key}'."

    if entry.status in ("ACCEPT", "ACCEPT_FOR_INTEGRATION_TEST"):
        return True, ""

    if allow_unapproved:
        return True, f"[TESTING MODE] Model '{model_key}' is unapproved ({entry.rejection_reason}) but bypassed by request."

    return False, entry.rejection_reason
