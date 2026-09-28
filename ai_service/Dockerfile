# Production Dockerfile for Sổ Chi Tiêu AI Service
FROM python:3.12-slim AS base

WORKDIR /app

# Install security and build updates
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY ai_service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy models and code
COPY model_classify_v3 /app/model_classify_v3
COPY model_warning_v3 /app/model_warning_v3
COPY model_prediction_v3 /app/model_prediction_v3
COPY model_advisor /app/model_advisor
COPY model_classify_v2 /app/model_classify_v2
COPY model_warning_v2 /app/model_warning_v2
COPY model_prediction_v2 /app/model_prediction_v2
COPY ai_service /app/ai_service

ENV PYTHONUNBUFFERED=1 \
    PORT=8000 \
    AI_SERVICE_HOST=0.0.0.0 \
    AI_SERVICE_PORT=8000 \
    AI_V3_CANARY_PERCENT=0 \
    AI_SHADOW_MODE=true \
    AI_SHADOW_SAMPLE_RATE=0.05 \
    AI_MODEL_FALLBACK_ENABLED=true

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["sh", "-c", "uvicorn ai_service.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
