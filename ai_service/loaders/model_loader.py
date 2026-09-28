"""
ai_service/loaders/model_loader.py
==================================
Thread-safe singleton model container.
Supports multi-version loading (V3 Primary, V2 Baseline / Fallback).
Prevents namespace collisions between V2 and V3 scripts using scoped module isolation.
"""

import sys
import logging
import contextlib
from pathlib import Path
from typing import Dict, Any, Optional

from ai_service.config import (
    MODEL_CLASSIFY_V4_DIR,
    MODEL_CLASSIFY_V3_DIR,
    MODEL_CLASSIFY_V2_DIR,
    MODEL_WARNING_V3_DIR,
    MODEL_WARNING_V2_DIR,
    MODEL_PREDICTION_V3_DIR,
    MODEL_PREDICTION_V2_DIR,
    MODEL_ADVISOR_V3_DIR,
    AI_CLASSIFY_MODEL_VERSION,
    AI_RISK_MODEL_VERSION,
    AI_FORECAST_MODEL_VERSION,
    AI_ADVISOR_MODEL_VERSION,
    AI_MODEL_FALLBACK_ENABLED,
    AI_CLASSIFY_V4_SHADOW_ENABLED,
)

logger = logging.getLogger("ai_service.loaders")


@contextlib.contextmanager
def _scoped_env(scripts_dir: Path, clean_modules: list):
    """Context manager to ensure scripts_dir is on sys.path during import AND unpickling."""
    str_dir = str(scripts_dir.resolve())
    sys.path.insert(0, str_dir)
    for m in clean_modules:
        sys.modules.pop(m, None)
    try:
        yield
    finally:
        if sys.path and sys.path[0] == str_dir:
            sys.path.pop(0)
        for m in clean_modules:
            sys.modules.pop(m, None)


class ModelContainer:
    """Singleton holding all pre-loaded V3 primary and V2 fallback model instances."""

    _instance: Optional["ModelContainer"] = None

    def __init__(self):
        # Primary V3 engines
        self.classify_engine_v3 = None
        self.risk_engine_v3 = None
        self.forecast_engine_v3 = None
        self.advisor_engine_v3 = None

        # Shadow Candidate V4 engines
        self.classify_engine_v4 = None

        # Fallback V2 engines
        self.classify_engine_v2 = None
        self.risk_engine_v2 = None
        self.forecast_engine_v2 = None

        self.loaded_status: Dict[str, bool] = {
            "classify": False,
            "forecast": False,
            "risk": False,
            "advisor": False,
            "classify_v4": False,
            "classify_v3": False,
            "classify_v2": False,
            "risk_v3": False,
            "risk_v2": False,
            "forecast_v3": False,
            "forecast_v2": False,
            "advisor_v3": False,
        }

    @classmethod
    def get_instance(cls) -> "ModelContainer":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def classify_engine(self):
        """Active classify engine according to config and availability."""
        if AI_CLASSIFY_MODEL_VERSION == "v2":
            return self.classify_engine_v2 or self.classify_engine_v3
        return self.classify_engine_v3 or self.classify_engine_v2

    @property
    def risk_engine(self):
        """Active risk engine according to config and availability."""
        if AI_RISK_MODEL_VERSION == "v2":
            return self.risk_engine_v2 or self.risk_engine_v3
        return self.risk_engine_v3 or self.risk_engine_v2

    @property
    def forecast_engine(self):
        """Active forecast engine according to config and availability."""
        if AI_FORECAST_MODEL_VERSION == "v2":
            return self.forecast_engine_v2 or self.forecast_engine_v3
        return self.forecast_engine_v3 or self.forecast_engine_v2

    @property
    def advisor_engine(self):
        """Active advisor engine."""
        return self.advisor_engine_v3

    def get_health_status(self) -> str:
        """
        Determines overall health status:
        - 'ok': All primary models loaded.
        - 'degraded': At least one primary model failed, but fallback is ready.
        - 'unhealthy': Core functionality completely unavailable.
        """
        primaries = [
            (self.classify_engine_v3 is not None, self.classify_engine_v2 is not None),
            (self.risk_engine_v3 is not None, self.risk_engine_v2 is not None),
            (self.forecast_engine_v3 is not None, self.forecast_engine_v2 is not None),
            (self.advisor_engine_v3 is not None, True),
        ]

        all_primaries_ok = all(p[0] for p in primaries)
        if all_primaries_ok:
            return "ok"

        # Check if fallback saves it
        all_covered = all(p[0] or p[1] for p in primaries)
        if all_covered:
            return "degraded"

        return "unhealthy"

    def verify_checksums(self) -> bool:
        """Verify sha256 checksums of model artifacts if checksums registry exists."""
        import hashlib
        import json
        checksum_file = Path(__file__).resolve().parent.parent / "model_checksums.json"
        if not checksum_file.exists():
            logger.info("No model_checksums.json found; skipping checksum validation.")
            return True
        try:
            with open(checksum_file, "r", encoding="utf-8") as f:
                expected_checksums = json.load(f)
            project_root = Path(__file__).resolve().parent.parent.parent
            for rel_path, expected_hash in expected_checksums.items():
                p = project_root / rel_path
                if p.is_file():
                    actual_hash = hashlib.sha256(p.read_bytes()).hexdigest()
                    if actual_hash != expected_hash:
                        logger.critical(f"FATAL: Model artifact corrupted! Checksum mismatch for {rel_path}. Expected {expected_hash}, got {actual_hash}")
                        return False
            logger.info(f"✔ All {len(expected_checksums)} model artifact checksums verified successfully.")
            return True
        except Exception as e:
            logger.warning(f"Error validating checksums: {e}")
            return True

    def load_all_models(self):
        """Load all primary and fallback artifacts once at application startup."""
        logger.info("Initializing ModelContainer — verifying checksums & loading model artifacts...")
        self.verify_checksums()

        # 1. Classify V3 (PRIMARY)
        self._load_classify_v3()
        # 1b. Classify V4 (SHADOW CANDIDATE)
        if AI_CLASSIFY_V4_SHADOW_ENABLED:
            self._load_classify_v4()
        # 2. Classify V2 (FALLBACK)
        if AI_MODEL_FALLBACK_ENABLED or AI_CLASSIFY_MODEL_VERSION == "v2":
            self._load_classify_v2()

        # 3. Risk V3
        self._load_risk_v3()
        # 4. Risk V2
        if AI_MODEL_FALLBACK_ENABLED or AI_RISK_MODEL_VERSION == "v2":
            self._load_risk_v2()

        # 5. Forecast V3
        self._load_forecast_v3()
        # 6. Forecast V2
        if AI_MODEL_FALLBACK_ENABLED or AI_FORECAST_MODEL_VERSION == "v2":
            self._load_forecast_v2()

        # 7. Advisor V3
        self._load_advisor_v3()

        # Update high-level status for backwards compatibility
        self.loaded_status["classify"] = (self.classify_engine_v3 is not None) or (self.classify_engine_v2 is not None)
        self.loaded_status["risk"] = (self.risk_engine_v3 is not None) or (self.risk_engine_v2 is not None)
        self.loaded_status["forecast"] = (self.forecast_engine_v3 is not None) or (self.forecast_engine_v2 is not None)
        self.loaded_status["advisor"] = (self.advisor_engine_v3 is not None)

        logger.info(f"ModelContainer initialization complete. Overall Health: {self.get_health_status()}. Status: {self.loaded_status}")

    def _load_classify_v4(self):
        try:
            artifact_file = MODEL_CLASSIFY_V4_DIR / "models" / "classifier_model.pkl"
            if not MODEL_CLASSIFY_V4_DIR.exists() or not artifact_file.exists():
                logger.info("model_classify_v4 artifact not found; shadow mode will be inactive.")
                self.loaded_status["classify_v4"] = False
                self.classify_engine_v4 = None
                return
            with _scoped_env(MODEL_CLASSIFY_V4_DIR / "scripts", ["predict", "preprocess"]):
                from predict import VietnameseClassifierEngineV4
                self.classify_engine_v4 = VietnameseClassifierEngineV4(models_dir=MODEL_CLASSIFY_V4_DIR / "models")
            self.loaded_status["classify_v4"] = True
            logger.info("✔ Loaded model_classify_v4 successfully (SHADOW CANDIDATE).")
        except Exception as e:
            logger.warning(f"Could not load shadow candidate model_classify_v4: {e}")
            self.classify_engine_v4 = None
            self.loaded_status["classify_v4"] = False

    def _load_classify_v3(self):
        try:
            with _scoped_env(MODEL_CLASSIFY_V3_DIR / "scripts", ["predict", "preprocess"]):
                from predict import VietnameseClassifierEngineV3
                self.classify_engine_v3 = VietnameseClassifierEngineV3(models_dir=MODEL_CLASSIFY_V3_DIR / "models")
            self.loaded_status["classify_v3"] = True
            logger.info("✔ Loaded model_classify_v3 successfully (PRIMARY).")
        except Exception as e:
            logger.error(f"Failed to load model_classify_v3: {e}", exc_info=True)
            self.loaded_status["classify_v3"] = False

    def _load_classify_v2(self):
        try:
            with _scoped_env(MODEL_CLASSIFY_V2_DIR / "scripts", ["predict", "preprocess"]):
                from predict import VietnameseClassifierEngine
                self.classify_engine_v2 = VietnameseClassifierEngine(models_dir=MODEL_CLASSIFY_V2_DIR / "models")
            self.loaded_status["classify_v2"] = True
            logger.info("✔ Loaded model_classify_v2 successfully (FALLBACK).")
        except Exception as e:
            logger.warning(f"Could not load fallback model_classify_v2: {e}")
            self.loaded_status["classify_v2"] = False

    def _load_risk_v3(self):
        try:
            with _scoped_env(MODEL_WARNING_V3_DIR / "scripts", ["predict", "pipeline", "classifier"]):
                from predict import RiskWarningEngineV3
                self.risk_engine_v3 = RiskWarningEngineV3(models_dir=MODEL_WARNING_V3_DIR / "models")
            self.loaded_status["risk_v3"] = True
            logger.info("✔ Loaded model_warning_v3 successfully (PRIMARY).")
        except Exception as e:
            logger.error(f"Failed to load model_warning_v3: {e}", exc_info=True)
            self.loaded_status["risk_v3"] = False

    def _load_risk_v2(self):
        try:
            with _scoped_env(MODEL_WARNING_V2_DIR / "scripts", ["predict", "pipeline", "classifier"]):
                from predict import RiskWarningEngine
                self.risk_engine_v2 = RiskWarningEngine(models_dir=MODEL_WARNING_V2_DIR / "models")
            self.loaded_status["risk_v2"] = True
            logger.info("✔ Loaded model_warning_v2 successfully (FALLBACK).")
        except Exception as e:
            logger.warning(f"Could not load fallback model_warning_v2: {e}")
            self.loaded_status["risk_v2"] = False

    def _load_forecast_v3(self):
        try:
            with _scoped_env(MODEL_PREDICTION_V3_DIR / "scripts", ["predict", "forecaster"]):
                from predict import DailyExpenseForecaster
                self.forecast_engine_v3 = DailyExpenseForecaster(models_dir=MODEL_PREDICTION_V3_DIR / "models")
            self.loaded_status["forecast_v3"] = True
            logger.info("✔ Loaded model_prediction_v3 successfully (PRIMARY).")
        except Exception as e:
            logger.error(f"Failed to load model_prediction_v3: {e}", exc_info=True)
            self.loaded_status["forecast_v3"] = False

    def _load_forecast_v2(self):
        try:
            with _scoped_env(MODEL_PREDICTION_V2_DIR / "scripts", ["predict", "forecaster"]):
                from predict import DailyExpenseForecaster
                self.forecast_engine_v2 = DailyExpenseForecaster(models_dir=MODEL_PREDICTION_V2_DIR / "models")
            self.loaded_status["forecast_v2"] = True
            logger.info("✔ Loaded model_prediction_v2 successfully (FALLBACK).")
        except Exception as e:
            logger.warning(f"Could not load fallback model_prediction_v2: {e}")
            self.loaded_status["forecast_v2"] = False

    def _load_advisor_v3(self):
        try:
            with _scoped_env(MODEL_ADVISOR_V3_DIR / "scripts", ["inference", "train"]):
                from inference import AdvisorInferenceEngine
                self.advisor_engine_v3 = AdvisorInferenceEngine(model_path=MODEL_ADVISOR_V3_DIR / "models" / "advisor_model.pkl")
            self.loaded_status["advisor_v3"] = True
            logger.info("✔ Loaded model_advisor v3 successfully (PRIMARY).")
        except Exception as e:
            logger.error(f"Failed to load model_advisor: {e}", exc_info=True)
            self.loaded_status["advisor_v3"] = False
