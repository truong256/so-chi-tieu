# ==================================================
# AI V4 SECURE CANARY 5% DEPLOYMENT REPORT
# ==================================================

## GIT
- **Branch**: `ai/retrain-v3`
- **HEAD**: `ce7ca58` (merge: tích hợp tính năng Admin, RBAC, phân tích tài chính và chuẩn hóa hệ thống)
- **Working tree**: Preserved; active working tree contains only necessary configuration, telemetry, tests, and admin observability enhancements.

---

## DATABASE
- **Migration 015**: `database/migrations/015_ai_canary_telemetry.sql` & `supabase/migrations/015_ai_canary_telemetry.sql`
- **Applied**: YES (Applied to linked Supabase remote project `kywprntrflvuclpjhcqz` via `npx supabase db push --include-all`; confirmed with `npx supabase migration list`).
- **Telemetry table**: `public.ai_canary_telemetry`
- **RLS/security**: 
  - Row Level Security ENABLED.
  - SELECT restricted to authenticated administrators (`public.is_admin()`).
  - INSERT granted to authenticated backend service roles.
  - Security DEFINER trigger `trg_assert_no_ai_telemetry_pii` enforces `length(category) <= 50` and `length(user_id_hash) <= 64` with strict search_path.
- **Raw text stored**: NOT STORED (Zero raw transaction text, full prompts, or financial secrets persisted).

---

## RUNTIME
- **Primary**: `v3` (`AI_CLASSIFY_PRIMARY_VERSION=v3`)
- **Shadow**: `enabled` (`AI_CLASSIFY_V4_SHADOW_ENABLED=true`, `AI_SHADOW_MODE=true`)
- **Canary enabled**: `true` (`AI_CLASSIFY_V4_CANARY_ENABLED=true`)
- **Canary percentage**: `5%` (`AI_CLASSIFY_V4_CANARY_PERCENT=5`, strictly clamped to `0 <= percent <= 5`)

---

## DEPLOYMENT
- **Instances**: `1`
- **Workers**: `1` (Single Uvicorn worker process on `127.0.0.1:8000`)
- **Circuit breaker scope**: In-process sliding window (`canary_guard.py`).
- **Architecture Note**: Deployment is strictly **Option A (Single Instance / Single Worker)**. Circuit breaker state is memory-isolated within this single process. Multi-instance horizontal scaling would require external distributed state (e.g. Redis) before widening canary scope.

---

## ROUTING
- **10k distribution**: 9,468 V3 (94.68%) / 532 V4 (5.32%) — within the target `[4.5%, 5.5%]` tolerance interval.
- **Deterministic**: PASS (Same user always hashes to identical bucket across calls: verified with 100 repeated requests).
- **Restart stable**: PASS (Deterministic SHA-256 bucket assignment invariant across process restarts).
- **Client override blocked**: PASS (Client `preferred_version=v4` is stripped and ignored server-side; server maintains sole routing authority).

---

## FAILOVER
- **Missing V4**: PASS (If V4 model artifact is None, immediately falls back to V3 Control with `fallback_used: true`).
- **Corrupt V4**: PASS (Corrupt pickle/tensor throws caught safely; immediately falls back to V3 Control).
- **Timeout V4**: PASS (Slow inference caught by timeout guard; immediately falls back to V3 Control).
- **Malformed V4**: PASS (Invalid schema missing category or confidence caught; immediately falls back to V3 Control).
- **Telemetry failure**: PASS (Disk I/O and database network errors safely isolated; classification never fails).
- **Unexpected exception**: PASS (Unhandled errors caught, falls back to V3 Control, zero stack traces leaked).

---

## CIRCUIT BREAKER
- **3 consecutive failures**: PASS (Breaker trips immediately to OPEN).
- **Error rate**: PASS (Breaker trips if V4 error rate exceeds 5% in sliding window).
- **Latency**: PASS (Breaker trips if V4 p95 latency exceeds 50ms).
- **Route after trip**: 100% of subsequent traffic routes to V3 Control; 0 requests sent to V4 until manual reset.

---

## TELEMETRY
- **V3 events**: Monitored & recorded.
- **V4 events**: Monitored & recorded.
- **Fallback**: Tracked (`fallback_used: boolean`).
- **Raw text**: NOT STORED (Audited across all telemetry outputs).
- **PII**: NOT STORED (Pseudonymous SHA-256 user hashes only, max 64 chars).
- **Secrets**: NOT STORED (Scanned across all files and outputs: 0 hardcoded secrets).

---

## REAL TRAFFIC
- **Valid real events**: `0`
- **Required**: `500`
- **Progress**: `0 / 500`
- **Policy**: Synthetic benchmarks, unit tests, and live smoke test requests explicitly set `is_real_traffic: False` and NEVER increment the real-event counter. Only authentic authenticated app transactions count.

---

## MODEL METRICS (Clean Holdout Benchmark)
- **V3 clean accuracy**: `77.35%`
- **V3 Macro F1**: `0.7710`
- **V3 High-confidence wrong**: `4`
- **V4 clean accuracy**: `86.75%`
- **V4 Macro F1**: `0.8656`
- **V4 High-confidence wrong**: `0`

---

## TESTS
- **Python**: `130 / 130 PASS` (`pytest ai_service/tests model_advisor/tests -v`)
- **Node**: `66 / 66 PASS` (`npm run test:unit`)
- **Security**: `PASS` (Token rotation verified, fail-closed auth, 0 hardcoded secrets)
- **Canary**: `21 / 21 PASS` (`test_canary_readiness.py`)
- **Lint**: `PASS` (`npm run lint`: 0 errors, 7 warnings)
- **Typecheck**: `PASS` (`npx tsc --noEmit`: 0 errors)
- **Build**: `PASS` (`npm run build`: Next.js & Vite worker builds successful)

---

## PROMOTION
- **Current primary**: `v3`
- **Current canary**: `v4 (5%)`
- **Promotion >5%**: `BLOCKED`
- **Reason**: Insufficient real user traffic (`0 / 500` valid real events). Promotion gate strictly locked until $\ge 500$ real user events are collected and the observation window is complete.

---

## REMAINING ISSUES
- **REMAINING P0**: `0`
- **REMAINING P1**: `0`
- **REMAINING P2**: `0`

---

## FINAL STATUS
```text
==================================================
FINAL STATUS: ENABLE SECURE 5% CANARY

PROMOTION >5%:
BLOCKED UNTIL >=500 VALID REAL EVENTS
AND OBSERVATION WINDOW COMPLETE
==================================================
```
