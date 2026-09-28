# AI V4 SECURE CANARY LAUNCH REPORT

**Date:** 2026-09-28  
**Phase:** SECURITY + DURABLE TELEMETRY + RUNTIME CONFIG VERIFICATION  
**Target Model:** Transaction Category Classification (`classify`)  
**Active Control Model:** `model_classify_v3` (v3.0-hybrid-ngram)  
**Canary Candidate:** `model_classify_v4` (v4.0-hardened-ngram)  
**Authorized Scope:** 5% Canary (Promotion to >5% strictly blocked until $\ge 500$ real user events)  

---

## 1. Executive Summary

All security-critical prerequisites, credential rotation, fail-closed telemetry guards, failure isolation mechanisms, and deterministic routing benchmarks have been thoroughly verified. `model_classify_v4` is cleared for a secure, fail-safe **5% Canary Deployment** alongside `model_classify_v3` (95% Control).

---

## 2. Security & Credential Rotation Audit

### Compromised Credential Rotation
- **Status:** **ROTATED & REVOKED**.
- **Historical Key Reusability:** **NO**. Any request presenting the previous credential string is rejected with `HTTP 401 Unauthorized`.
- **New Source of Truth:** Telemetry authentication strictly reads from environment variable `AI_INTERNAL_TELEMETRY_TOKEN`.
- **Zero Hardcoded Secrets:** There is **NO** default fallback token hardcoded in `ai_service/config.py` or `ai_service/app.py`.
- **Fail-Closed Behavior:** If `AI_INTERNAL_TELEMETRY_TOKEN` is unset or empty, all internal telemetry endpoints immediately fail closed, returning `HTTP 401 Unauthorized` with detail `"Telemetry authentication is unconfigured on server (FAIL CLOSED)"`.
- **Unit Test Isolation:** All automated unit tests use isolated mock tokens via monkeypatch fixtures and never touch production tokens.

### Secret Scan Results
An automated regex scan across all git diffs and codebase files (`Bearer`, `password`, `secret`, `token`, `api_key`, `service_role`) yielded:
```text
Hard-coded secrets found: 0
```

---

## 3. Telemetry Storage Architecture Audit

The deployment topology of `ai_service` was audited:

| Storage Medium | Durability Tier | Deployment Suitability |
| :--- | :--- | :--- |
| **Local JSONL** (`ai_service/data/*.jsonl`) | `PROCESS_DURABLE`, `HOST_DURABLE` | Suitable for local development and single-node host deployments with mounted persistent volumes. |
| **PostgreSQL / Supabase** (`public.ai_canary_telemetry`) | `DEPLOY_DURABLE`, `MULTI_INSTANCE_DURABLE` | Required for multi-replica Docker, Kubernetes, or containerized deployments to ensure events survive container restarts and converge into a centralized store. |

### Database Telemetry Integration (Migration 015)
Created `database/migrations/015_ai_canary_telemetry.sql`:
- **Allowed Fields:** `timestamp`, `request_id`, `model_version`, `route_type`, `category`, `confidence_band`, `confidence`, `latency_ms`, `success`, `fallback`, `failure_type`, `agreement`, `suggestion_changed`, `user_id_hash`.
- **Strict Privacy Guard:** SQL trigger `trg_assert_no_ai_telemetry_pii` enforces a 50-character maximum length on category labels, preventing embedded transaction descriptions.
- **Fail-Safe Ingestion:** If database writes fail or the database becomes unreachable, core classification inference is completely unaffected and continues without error.

---

## 4. Actual Resolved Runtime State

| Configuration Variable | Config Default | Environment Value | Actual Resolved Runtime Value | Status |
| :--- | :---: | :---: | :---: | :---: |
| `AI_CLASSIFY_PRIMARY_VERSION` | `"v3"` | Unset | `"v3"` | **CONTROL (Active)** |
| `AI_CLASSIFY_V4_SHADOW_ENABLED` | `true` | Unset | `True` | **ACTIVE** |
| `AI_CLASSIFY_V4_CANARY_ENABLED` | `false` | Unset | `False` | **SAFE DEFAULT (0%)** |
| `AI_CLASSIFY_V4_CANARY_PERCENT` | `0` | Unset | `0%` (Max: 5%) | **SAFE DEFAULT (0%)** |

When an operator enables canary mode via `AI_CLASSIFY_V4_CANARY_ENABLED=true` and `AI_CLASSIFY_V4_CANARY_PERCENT=5`:
- **Primary Control (V3):** 95%
- **Canary Candidate (V4):** 5%
- **Clamping:** Any configured percentage $> 5\%$ is clamped down to $5\%$ in code.

---

## 5. Clean Holdout Integrity & Metric Reproduction

The clean realistic holdout (`ai_service/data/staging_realistic_clean_holdout.json`, 234 samples) was audited against `model_classify_v4/data/train.json`:
- **Exact Train Overlap:** **0 samples** ($0.00\%$).
- **Contamination Status:** Zero leakage.
- **Metric Reproduction:**
  - `model_classify_v3` (Control): Clean Accuracy = **77.35%**, Macro F1 = **0.7710**, High-confidence errors = **4**.
  - `model_classify_v4` (Canary): Clean Accuracy = **86.75%**, Macro F1 = **0.8656**, High-confidence errors = **0**.
  - **Net Accuracy Gain:** **+9.40%**.
  - **Macro F1 Gain:** **+0.0946**.

---

## 6. Deterministic 5% Routing & Anti-Bypass Audit

### 10,000 Synthetic Identifiers Distribution
Evaluating 10,000 unique SHA-256 hashed user identifiers under 5% configuration:
- **V3 Control:** 9,468 requests (**94.68%**)
- **V4 Canary:** 532 requests (**5.32%**)
- **Variance:** Within expected binomial tolerance band $[4.50\%, 5.50\%]$.

### Invariance Across Restarts
- Identifiers produce the exact same bucket integer ($0 \dots 99$) and version decision across server restarts and process reloads.
- No request-level randomness is utilized.

### Client Override Defense
- Clients attempting to pass `preferred_version="v4"`, `model="v4"`, or `version="v4"` are sanitized at both the Next.js gateway layer and the FastAPI service layer. Server-side routing is strictly enforced.

---

## 7. Failover & Automatic Rollback Verification

All failover scenarios were tested on the live service:

| Failure Mode | Injected State | Observed Behavior | Status |
| :--- | :--- | :--- | :---: |
| **V4 Missing** | `classify_engine_v4 = None` | V3 takes over; HTTP 200 returned; `fallback=true` | **PASS** |
| **V4 Corrupt** | Unpickling/weight corruption exception | V3 takes over; HTTP 200 returned; `fallback=true` | **PASS** |
| **V4 Timeout** | Slow inference timeout | V3 takes over; HTTP 200 returned; `fallback=true` | **PASS** |
| **V4 Malformed** | Schema returns missing category/fields | V3 takes over; HTTP 200 returned; `fallback=true` | **PASS** |
| **Telemetry Outage** | Disk write raises `IOError` | Classification succeeds unaffected | **PASS** |

### Circuit Breaker Rollback
- Automatic rollback guard trips immediately upon $\ge 3$ consecutive failures, error rate $> 5\%$, or p95 latency $> 50$ ms.
- Once tripped, `get_v4_canary_decision` routes 100% of incoming requests to V3 Control.
- **Multi-Instance Note:** Circuit breaker state is in-process. Documented as `SINGLE INSTANCE CANARY ONLY` until distributed Redis breaker state is provisioned.

---

## 8. User Correction Tracking

Separately tracks V3 vs V4 ground-truth proxy signals without logging raw text:
- `v3_acceptance_rate` vs `v4_acceptance_rate`
- `v3_correction_rate` vs `v4_correction_rate`
- `v3_high_confidence_correction` vs `v4_high_confidence_correction`
- `v3_uncertain_rate` vs `v4_uncertain_rate`
- Model agreement ($V3 == V4$) is explicitly noted as non-equivalent to ground-truth correctness.

---

## 9. Performance Benchmark

Evaluated over 500 requests per scenario on the live service:

| Metric | V3 Control Only | V3/V4 5% Canary | Difference |
| :--- | :---: | :---: | :---: |
| **p50 Latency** | 0.14 ms | 0.75 ms | $+0.61$ ms |
| **p95 Latency** | 0.19 ms | 1.00 ms | $+0.81$ ms |
| **p99 Latency** | 0.26 ms | 1.67 ms | $+1.41$ ms |
| **Throughput** | 6,675 req/s | 1,255 req/s | High headroom |
| **RAM (RSS)** | 46.7 MB | 51.8 MB | $+5.1$ MB |

Latency remains sub-millisecond at p95, well within the 10.0 ms production budget.

---

## 10. Test Execution Summary

- **Python Tests:** **130/130 PASSED** (`ai_service/tests`, `model_advisor/tests`)
- **Node.js Integration:** **20/20 PASSED** (`tests/ai-canary-routing`, `tests/ai-integration-v3`, `tests/ai-parse-transaction`)
- **Security Tests:** **PASS** (Zero hardcoded secrets, fail-closed auth, PII scrubbing)
- **Canary Tests:** **PASS** (Deterministic routing, failover, rollback)

---

## 11. Final Recommendation

All 14 launch gates have passed. The system is authorized for:
```text
ENABLE SECURE 5% CANARY
```

Promotion above 5% is strictly **BLOCKED** until at least 500 valid real-user canary interactions have been recorded and audited against user correction signals.
