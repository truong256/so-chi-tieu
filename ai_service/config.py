"""
ai_service/config.py
====================
Configuration settings, version routing, and Model Registry for the AI Service.
Supports version selection (V3 default, V2 baseline), V3 -> V2 fallback, and Shadow Mode.
"""

import os
from pathlib import Path
from pydantic import BaseModel
from typing import Dict, Any

# Root paths
SERVICE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVICE_DIR.parent

# Model Directories V4 (Shadow Candidate)
MODEL_CLASSIFY_V4_DIR = PROJECT_ROOT / "model_classify_v4"

# Model Directories V3
MODEL_CLASSIFY_V3_DIR = PROJECT_ROOT / "model_classify_v3"
MODEL_WARNING_V3_DIR = PROJECT_ROOT / "model_warning_v3"
MODEL_PREDICTION_V3_DIR = PROJECT_ROOT / "model_prediction_v3"
MODEL_ADVISOR_V3_DIR = PROJECT_ROOT / "model_advisor"

# Model Directories V2 (Fallback & Shadow Baseline)
MODEL_CLASSIFY_V2_DIR = PROJECT_ROOT / "model_classify_v2"
MODEL_WARNING_V2_DIR = PROJECT_ROOT / "model_warning_v2"
MODEL_PREDICTION_V2_DIR = PROJECT_ROOT / "model_prediction_v2"

# Compatibility Aliases
MODEL_CLASSIFY_DIR = MODEL_CLASSIFY_V3_DIR
MODEL_WARNING_DIR = MODEL_WARNING_V3_DIR
MODEL_PREDICTION_DIR = MODEL_PREDICTION_V3_DIR
MODEL_ADVISOR_DIR = MODEL_ADVISOR_V3_DIR

HOST = os.getenv("AI_SERVICE_HOST", "0.0.0.0")
PORT = int(os.getenv("AI_SERVICE_PORT", "8000"))
SERVICE_NAME = "So Chi Tieu AI Service"
SERVICE_VERSION = "3.0.0"

# Version Selection Configuration
AI_CLASSIFY_PRIMARY_VERSION = os.getenv("AI_CLASSIFY_PRIMARY_VERSION", "v3").lower().strip()
AI_CLASSIFY_MODEL_VERSION = os.getenv("AI_CLASSIFY_MODEL_VERSION", AI_CLASSIFY_PRIMARY_VERSION).lower().strip()
AI_RISK_MODEL_VERSION = os.getenv("AI_RISK_MODEL_VERSION", "v3").lower().strip()
AI_FORECAST_MODEL_VERSION = os.getenv("AI_FORECAST_MODEL_VERSION", "v3").lower().strip()
AI_ADVISOR_MODEL_VERSION = os.getenv("AI_ADVISOR_MODEL_VERSION", "v3").lower().strip()

# Internal Telemetry & Service Security Tokens (Rotation required, zero hardcoded fallback secret)
# If unconfigured in environment, telemetry endpoints fail closed (HTTP 401).
_raw_telemetry_token = os.getenv("AI_INTERNAL_TELEMETRY_TOKEN", "").strip()
_raw_service_token = os.getenv("AI_INTERNAL_SERVICE_TOKEN", "").strip() or _raw_telemetry_token
AI_INTERNAL_TELEMETRY_TOKEN = _raw_telemetry_token if _raw_telemetry_token else None
AI_INTERNAL_SERVICE_TOKEN = _raw_service_token if _raw_service_token else None

# Fallback & Shadow Configuration
AI_MODEL_FALLBACK_ENABLED = os.getenv("AI_MODEL_FALLBACK_ENABLED", "true").lower().strip() in ("true", "1", "yes")
AI_SHADOW_MODE = os.getenv("AI_SHADOW_MODE", "true").lower().strip() in ("true", "1", "yes")
AI_CLASSIFY_V4_SHADOW_ENABLED = os.getenv("AI_CLASSIFY_V4_SHADOW_ENABLED", "true").lower().strip() in ("true", "1", "yes")

# Classify V4 Canary Configuration (Phase limit: max 5%)
AI_CLASSIFY_V4_CANARY_ENABLED = os.getenv("AI_CLASSIFY_V4_CANARY_ENABLED", "true").lower().strip() in ("true", "1", "yes")
try:
    _raw_v4_canary = os.getenv("AI_CLASSIFY_V4_CANARY_PERCENT", "5").strip()
    _val = int(_raw_v4_canary)
    # Strictly clamp to phase limit: 0 to 5%
    if _val < 0:
        AI_CLASSIFY_V4_CANARY_PERCENT = 0
    elif _val > 5:
        AI_CLASSIFY_V4_CANARY_PERCENT = 5
    else:
        AI_CLASSIFY_V4_CANARY_PERCENT = _val
except (ValueError, TypeError):
    AI_CLASSIFY_V4_CANARY_PERCENT = 0

try:
    AI_SHADOW_SAMPLE_RATE = float(os.getenv("AI_SHADOW_SAMPLE_RATE", "1.0").strip())
    AI_SHADOW_SAMPLE_RATE = max(0.0, min(1.0, AI_SHADOW_SAMPLE_RATE))
except (ValueError, TypeError):
    AI_SHADOW_SAMPLE_RATE = 1.0

# Legacy V3 Canary Configuration (Independent from V4 Canary)
try:
    _raw_canary = os.getenv("AI_V3_CANARY_PERCENT", "0").strip()
    AI_V3_CANARY_PERCENT = int(_raw_canary)
    if AI_V3_CANARY_PERCENT < 0 or AI_V3_CANARY_PERCENT > 100:
        AI_V3_CANARY_PERCENT = 0
except (ValueError, TypeError):
    AI_V3_CANARY_PERCENT = 0


def stable_user_bucket(user_id: str) -> int:
    """Deterministic hash of user_id to bucket 0..99 using SHA-256."""
    import hashlib
    digest = hashlib.sha256(user_id.encode("utf-8")).digest()
    uint_val = int.from_bytes(digest[:4], byteorder="big")
    return uint_val % 100


def get_v4_canary_decision(user_id: str = None) -> tuple[bool, str, int]:
    """
    Evaluate deterministic V4 canary assignment.
    Returns: (is_canary, target_version, bucket)
    Rules:
    - If AI_CLASSIFY_V4_CANARY_ENABLED is False -> (False, "v3", 0) [100% V3 Control]
    - If automatic rollback circuit is tripped -> (False, "v3", 0) [100% V3 Control]
    - If AI_CLASSIFY_V4_CANARY_PERCENT <= 0 -> (False, "v3", 0) [100% V3 Control]
    - If user_id is empty/invalid -> (False, "v3", 0) [Fail-safe V3 Control]
    - bucket = stable_user_bucket(user_id) % 100
    - If bucket < AI_CLASSIFY_V4_CANARY_PERCENT -> (True, "v4", bucket)
    - Else -> (False, "v3", bucket)
    """
    from ai_service.services.canary_guard import is_v4_canary_tripped

    if not AI_CLASSIFY_V4_CANARY_ENABLED:
        return False, "v3", 0
    if is_v4_canary_tripped():
        return False, "v3", 0
    if AI_CLASSIFY_V4_CANARY_PERCENT <= 0:
        return False, "v3", 0
    if not user_id:
        return False, "v3", 0

    bucket = stable_user_bucket(str(user_id))
    is_canary = bucket < AI_CLASSIFY_V4_CANARY_PERCENT
    target_version = "v4" if is_canary else "v3"
    return is_canary, target_version, bucket


def get_canary_decision(user_id: str = None) -> tuple[bool, str, int]:
    """
    Legacy V3 vs V2 canary decision.
    Returns (is_canary, target_version, bucket).
    """
    if AI_V3_CANARY_PERCENT <= 0:
        return False, "v2", 0
    if AI_V3_CANARY_PERCENT >= 100:
        return False, "v3", 0
    if not user_id:
        return False, "v2", 0
    bucket = stable_user_bucket(str(user_id))
    is_canary = bucket < AI_V3_CANARY_PERCENT
    target_version = "v3" if is_canary else "v2"
    return is_canary, target_version, bucket


def should_run_shadow(sample_seed: float = None) -> bool:
    """Determine whether to run shadow inference based on mode and sample rate."""
    if not AI_SHADOW_MODE:
        return False
    if AI_SHADOW_SAMPLE_RATE >= 1.0:
        return True
    if AI_SHADOW_SAMPLE_RATE <= 0.0:
        return False
    import random
    if sample_seed is not None:
        return (hash(str(sample_seed)) % 1000) / 1000.0 < AI_SHADOW_SAMPLE_RATE
    return random.random() < AI_SHADOW_SAMPLE_RATE


class ModelRegistryEntry(BaseModel):
    name: str
    status: str  # "ACCEPT", "REJECT", or "ACCEPT_FOR_INTEGRATION_TEST"
    rejection_reason: str = ""
    version: str
    description: str


MODEL_REGISTRY: Dict[str, ModelRegistryEntry] = {
    "classify": ModelRegistryEntry(
        name="model_classify_v3",
        status="PRODUCTION_CONTROL",
        rejection_reason="",
        version="v3.0-hybrid-ngram",
        description="Vietnamese transaction text category classifier (Zero leakage, Word(1,2)+Char(3,4) TF-IDF, Softmax LR, calibrated confidence)",
    ),
    "classify_v3": ModelRegistryEntry(
        name="model_classify_v3",
        status="PRODUCTION_CONTROL",
        rejection_reason="",
        version="v3.0-hybrid-ngram",
        description="Production control classifier (Clean holdout acc ~77.35%, macro F1 ~0.7710)",
    ),
    "classify_v4": ModelRegistryEntry(
        name="model_classify_v4",
        status="CANARY_5_PERCENT",
        rejection_reason="Promotion >5% locked until >= 500 valid real-user events collected",
        version="v4.0-calibrated-canary",
        description="Canary candidate classifier (Clean holdout acc ~86.75%, macro F1 ~0.8656, capped at 5% traffic)",
    ),
    "forecast": ModelRegistryEntry(
        name="model_prediction_v3",
        status="PRODUCTION_ADVISORY",
        rejection_reason="",
        version="v3.0-walkforward",
        description="Dynamic multi-horizon time-series expense forecaster (Temporal split, Walk-forward recursive Ridge, sMAPE 25.17%)",
    ),
    "forecast_v3": ModelRegistryEntry(
        name="model_prediction_v3",
        status="PRODUCTION_ADVISORY",
        rejection_reason="",
        version="v3.0-walkforward",
        description="Production advisory forecaster (Beats naive moving average baselines, sMAPE 25.17%)",
    ),
    "risk": ModelRegistryEntry(
        name="model_warning_v3",
        status="EXPERIMENTAL",
        rejection_reason="Synthetic F1=1.0 but realistic challenge validation F1 ~57.14%; shortcut suspected",
        version="v3.0-leakage-free-hardened",
        description="Risk classifier baseline (Experimental status due to synthetic shortcut risk)",
    ),
    "warning_v3": ModelRegistryEntry(
        name="model_warning_v3",
        status="EXPERIMENTAL",
        rejection_reason="Synthetic F1=1.0 but realistic challenge validation F1 ~57.14%; shortcut suspected",
        version="v3.0-leakage-free-hardened",
        description="Risk classifier baseline (Experimental status due to synthetic shortcut risk)",
    ),
    "advisor": ModelRegistryEntry(
        name="model_advisor",
        status="ADVISORY_EXPERIMENTAL",
        rejection_reason="",
        version="advisor-v2-calibrated-hardened",
        description="Personal Financial Advisor (Advisory-only with data sparsity guardrails and uncertainty gating)",
    ),
}
