# BÁO CÁO PHÁT TRIỂN HỆ THỐNG AI SỔ CHI TIÊU (PRODUCTION HARDENING & TELEMETRY INTEGRITY)
**Repository**: [https://github.com/truong256/so-chi-tieu.git](https://github.com/truong256/so-chi-tieu.git)  
**Tài liệu**: `AI_CONTINUED_DEVELOPMENT_REPORT.md`  
**Ngày thực hiện**: 2026-09-29  

---

## 1. THÔNG TIN GIT & NHÁNH PHÁT TRIỂN

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Base Branch** | `origin/main` |
| **Base Commit SHA** | `99288952332cdf0b8490ba848fba1544e2ff7d0b` |
| **Working Branch** | `ai/production-learning-hardening` |
| **Audit & Fix Commit** | `41fb3c3831d1c316cf980308311be94aad6f380f` |
| **Out-of-Scope Files Reverted** | `frontend/components/dashboard.tsx` (restored to origin/main)<br>`frontend/styles/globals.css` (restored to origin/main)<br>`tests/transaction-table-layout.test.mjs` (removed) |
| **Trạng thái Merge** | Không merge vào `main` trong nhiệm vụ này (tuân thủ quy định). |

---

## 2. KẾT QUẢ AUDIT VÀ SỬA ĐỔI PRODUCTION CORRECTNESS

| STT | Hạng mục | Vấn đề ban đầu | Giải pháp kỹ thuật đã triển khai | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Promotion Gate 500 Events** | `get_real_events_status()` đếm tổng sự kiện `len(_real_event_records)`. Với tỷ lệ Canary 5% V4 / 95% V3, 500 sự kiện tổng chỉ có ~25 request V4. | Thiết kế lại telemetry phân rã rõ ràng: `total_real_events`, `v3_real_events`, `v4_real_events`, `valid_v4_canary_events`, `v4_success_events`, `v4_failure_events`, `v4_fallback_events`. Promotion gate V4 bắt buộc sử dụng `valid_v4_canary_events >= 500` (sự kiện V4 canary thành công, không fallback, không duplicate retry). Đạt 500 trả về `READY_FOR_HUMAN_REVIEW`, không tự động promote. | **PASS** |
| 2 | **Internal Trust Boundary** | Request body có `is_real_traffic: true` và `user_id` nhưng FastAPI AI service tin trực tiếp mà không có bằng chứng từ authenticated application flow. | Thiết lập trust boundary giữa Next.js server và FastAPI service qua header `X-AI-Internal-Token` (hoặc `Authorization: Bearer`), so sánh constant-time bằng `hmac.compare_digest`. Nếu thiếu token, sai token, hoặc unconfigured thì FastAPI vẫn classify bình thường (200 OK) nhưng cưỡng chế `effective_is_real_traffic = False`, không tăng promotion counter. Không hardcode token, không expose `NEXT_PUBLIC_*`. | **PASS** |
| 3 | **End-to-End Idempotency** | Python đã hỗ trợ `idempotency_key` deduplication nhưng `/api/ai/parse-transaction` và `/api/ai/classify` chưa sinh/truyền key trong luồng production. | Next.js trích xuất `x-idempotency-key`/`x-request-id` hoặc sinh UUID an toàn `tx_${crypto.randomUUID()}` (entropy cao, không chứa PII, không chứa raw transaction text, ổn định khi network retry). Truyền xuyên suốt qua `aiClassify` -> FastAPI -> `record_real_traffic_event`. Network retry 2x tăng counter đúng 1 lần; transaction khác nhau tăng độc lập. | **PASS** |
| 4 | **Node Fallback cho /classify** | Node client thực hiện lớp fallback thứ 2 tới V2 khi request thất bại/timeout, dẫn đến nguy cơ double inference và double telemetry. | Bỏ lớp fallback thứ 2 tại Node đối với `/classify` (`!isClassifyPath`). FastAPI là nguồn chân lý duy nhất (Single Source of Truth) quản lý V4 canary, V4 -> V3 fallback, và V3 -> V2 fallback. Next.js route fallback trực tiếp sang heuristic SmartParser mà không gọi lại AI service. | **PASS** |
| 5 | **V4 Feedback Metrics Isolation** | Local product metrics và feedback route có logic `modelVersion === "v2" ? "v2" : "v3"`, làm feedback của V4 bị dồn vào V3. | Chuẩn hóa types và metrics hỗ trợ độc lập cả `v2`, `v3`, `v4`. Tách bạch `v3_shown`, `v3_applied`, `v3_overridden` và `v4_shown`, `v4_applied`, `v4_overridden`. Tính toán độc lập `v3_acceptance_rate`, `v4_acceptance_rate`, `v3_correction_rate`, `v4_correction_rate`, `v3_high_confidence_correction_rate`, `v4_high_confidence_correction_rate`. Feedback V4 không bao giờ làm tăng counter V3. | **PASS** |
| 6 | **Warning Audit Naming & Metrics** | Script import `RiskWarningEngineV3` nhưng thư mục lại đặt tên `model_warning_v4` và registry ghi `warning_v4: REJECTED` khi chưa từng có artifact V4 thực sự. Verdict ghi FPR=41.18% lệch với FPR thực tế 47.06%. | Đổi tên thành `warning_v3_realistic_audit`. Giữ `warning_v3: EXPERIMENTAL` trong `MODEL_REGISTRY`, không đăng ký `warning_v4` ảo. Tính toán FPR động trực tiếp từ metrics (`47.06%`). Thay đổi mô tả dataset thành `24 manually structured realistic challenge cases`. Phân biệt rõ lịch sử shortcut concern từ synthetic data cũ với kết quả permutation hiện tại (nhạy cảm nhất với `transaction_amount=0.0714`, `mcc=0.0497`, `credit_limit=0.0259`, `card_on_dark_web=0.0`). | **PASS** |
| 7 | **Telemetry Storage & Database Schema** | Real event telemetry cần lưu trữ an toàn, phục hồi sau container restart, không crash inference. | Thêm migration `016_ai_telemetry_idempotency.sql` bổ sung cột `idempotency_key` và index cho bảng `public.ai_canary_telemetry`. Ghi bất đồng bộ Supabase qua daemon worker không ảnh hưởng latency inference. Thêm `ai_service/data/*.jsonl` vào `.gitignore` để không commit dữ liệu runtime vào Git. | **PASS** |

---

## 3. TRẠNG THÁI MÔ HÌNH TRONG MODEL REGISTRY

```mermaid
graph TD
    A[Client Request (Authenticated)] --> B{FastAPI AI Service (Trusted Token Verified)}
    B -->|Classify (Deterministic Bucket)| C[Classify V3: PRODUCTION_CONTROL 95%]
    B -.->|Canary Max 5%| D[Classify V4: CANARY_5_PERCENT 5%]
    B -->|Forecast| E[Forecast V3: PRODUCTION_ADVISORY]
    B -->|Warning Audit| F[Warning V3: EXPERIMENTAL]
    B -->|Advisor| G[Advisor: ADVISORY_EXPERIMENTAL]
    D -->|Gate: valid_v4_canary_events >= 500| H[Promotion >5%: BLOCKED (0/500)]
    F -.->|24 Challenge Cases| I[Audit Only: Precision 42.86%, FPR 47.06%]
```

| Tên mô hình | Phiên bản | Trạng thái Registry | Mô tả kỹ thuật & Vai trò |
| :--- | :--- | :--- | :--- |
| `classify_v3` | `v3.0-hybrid-ngram` | `PRODUCTION_CONTROL` | Phân loại giao dịch tiếng Việt (TF-IDF Word(1,2)+Char(3,4), Softmax LR, Holdout Acc 77.35%, F1 0.7710). |
| `classify_v4` | `v4.0-calibrated-canary` | `CANARY_5_PERCENT` | Ứng viên Canary phân bổ tối đa 5% traffic. Khóa chặt thăng cấp: yêu cầu `valid_v4_canary_events >= 500`. |
| `forecast_v3` | `v3.0-walkforward` | `PRODUCTION_ADVISORY` | Dự báo chi tiêu 7/14/30 ngày (Walk-forward recursive Ridge, 30-day sMAPE 25.17%). |
| `warning_v3` | `v3.0-leakage-free-hardened` | `EXPERIMENTAL` | Mô hình cảnh báo rủi ro baseline. Giữ trạng thái Thử nghiệm do kết quả challenge audit chưa đạt ngưỡng sản xuất. |
| `advisor` | `advisor-v2-calibrated-hardened` | `ADVISORY_EXPERIMENTAL` | Cố vấn tài chính Advisory-only với chính sách uncertainty và cảnh báo dữ liệu thưa. |

*Lưu ý*: Không đăng ký `warning_v4` trong `MODEL_REGISTRY` vì chưa có training pipeline hoặc model artifact V4 thực sự.

---

## 4. CHI TIẾT ĐÁNH GIÁ THỰC TẾ WARNING V3 REALISTIC AUDIT

- **Model thực tế đánh giá**: `RiskWarningEngineV3` (Audit thực tế trên bộ thử thách)
- **Tập dữ liệu**: `realistic_challenge_dataset.json` (24 manually structured realistic challenge cases)
- **Kết quả Metrics chi tiết**:
  - **TP**: 6
  - **FP**: 8
  - **TN**: 9
  - **FN**: 1
  - **Recall**: **85.71%** (Bắt được 6/7 giao dịch gian lận thực tế)
  - **Precision**: **42.86%** (Báo động nhầm 8 giao dịch chi tiêu lớn hợp lệ như học phí, viện phí, mua vàng)
  - **F1-Score**: **0.5714** (57.14%)
  - **False Positive Rate (FPR)**: **47.06%**
  - **False Negative Rate (FNR)**: **14.29%**
  - **PR-AUC**: **0.4865**
  - **Brier Score**: **0.1942**
- **Độ nhạy Permutation Feature Importance (Delta F1 drop)**:
  - `transaction_amount`: **0.0714**
  - `mcc`: **0.0497**
  - `credit_limit`: **0.0259**
  - `card_on_dark_web`: **0.0000**
  - `hour`: **0.0000**
  - `use_chip`: **0.0000**
  - `credit_score`: **0.0000**
- **Đánh giá Shortcut**: Phân biệt rõ lịch sử với thực nghiệm hiện tại: *Mối lo ngại shortcut bắt nguồn từ các audit dữ liệu synthetic trước đây; trong khi đánh giá permutation 24 ca thực tế hiện tại cho thấy độ nhạy quan sát được mạnh nhất lần lượt là transaction_amount, MCC và credit_limit.*
- **Kết luận Quality Gate**: **REJECT (EXPERIMENTAL)**. FPR=47.06% và Precision=42.86% không đạt ngưỡng sản xuất (Precision >= 70%, F1 >= 80%).

---

## 5. BẢO MẬT & IDEMPOTENCY CẤP ĐỘ SẢN XUẤT (NEW)

### TELEMETRY DATABASE WRITE SECURITY
- **Vấn đề ban đầu**: Migration 015 có policy `CREATE POLICY ai_canary_telemetry_insert ON public.ai_canary_telemetry FOR INSERT TO authenticated WITH CHECK (true);`. Bất kỳ client browser nào có Supabase session đều có thể tự gửi INSERT vào bảng telemetry thực.
- **Giải pháp triển khai (Migration 017)**:
  - Thu hồi toàn bộ quyền INSERT từ client-side roles:
    ```sql
    DROP POLICY IF EXISTS ai_canary_telemetry_insert ON public.ai_canary_telemetry;
    REVOKE INSERT ON public.ai_canary_telemetry FROM anon, authenticated;
    ```
  - Cấp toàn quyền INSERT & quản trị cho service role server-side:
    ```sql
    GRANT ALL ON public.ai_canary_telemetry TO service_role;
    ```
  - Giữ quyền SELECT cho `authenticated` duy nhất khi là Administrator (`is_admin()`).
  - Browser/client tuyệt đối không thể can thiệp hoặc chèn telemetry sự kiện thật trực tiếp vào Supabase.

### DISTRIBUTED IDEMPOTENCY
- **Vấn đề ban đầu**: Migration 016 chỉ có index thường `CREATE INDEX ON ai_canary_telemetry(idempotency_key);`. Khi nhiều instance/worker FastAPI chạy phân tán, hai worker có thể cùng chèn một `idempotency_key` đồng thời mà không bị chặn ở database.
- **Giải pháp triển khai (Migration 017 + PostgREST)**:
  - Dọn dẹp an toàn các bản ghi trùng lặp lịch sử (giữ lại bản ghi sớm nhất có tie-breaker qua ID).
  - Tạo partial unique index trên database:
    ```sql
    CREATE UNIQUE INDEX IF NOT EXISTS ai_canary_telemetry_idempotency_key_uidx
      ON public.ai_canary_telemetry (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    ```
  - Bổ sung ràng buộc độ dài khóa ở mức database:
    ```sql
    ALTER TABLE public.ai_canary_telemetry
      ADD CONSTRAINT ai_canary_telemetry_idempotency_key_len_chk
      CHECK (
        idempotency_key IS NULL
        OR length(idempotency_key) <= 128
      );
    ```
  - Khi chèn vào Supabase PostgREST, request kèm header `Prefer: resolution=ignore-duplicates,return=minimal`. Xử lý mã HTTP 409 Conflict như một sự kiện đã được ghi nhận trước đó (`already recorded`), hoàn toàn cô lập lỗi và không bao giờ trip circuit breaker hay làm fail transaction classification.

### CLIENT RETRY IDEMPOTENCY
- **Vấn đề ban đầu**: Hàm `aiParseTransaction()` ở frontend chưa tạo hoặc truyền stable client event ID. Nếu network retry cả Next.js request, server sẽ tự sinh UUID mới dẫn đến duplicate telemetry.
- **Giải pháp triển khai**:
  - Frontend cung cấp hàm `generateClientEventId()` tạo UUID ngẫu nhiên định dạng `tx_${crypto.randomUUID()}` (không chứa PII, text, email, amount, user ID).
  - `aiParseTransaction()` và `aiSuggestCategory()` sinh `client_event_id` một lần duy nhất cho mỗi thao tác logic của người dùng.
  - Vòng lặp network retry trong `postAi()` giữ nguyên tuyệt đối `eventId` qua các lần thử lại (gửi qua cả body `client_event_id` và headers `X-Idempotency-Key`, `X-Request-Id`).
  - Next.js server nhận và chuyển tiếp `idempotency_key` tới FastAPI AI service.
  - Kết quả: Thao tác retry cùng ID chỉ tạo đúng 1 bản ghi telemetry; thao tác người dùng mới sinh ID mới sẽ tạo bản ghi độc lập.

### DEPLOYMENT ENV CONFIGURATION
- **Đồng bộ biến môi trường**: Audit toàn bộ hệ thống gồm `backend/src/services/ai-local.client.ts`, `backend/src/services/admin-ai.service.ts`, `ai_service/config.py`, và `ai_service/app.py`. Tất cả sử dụng thống nhất và chính xác:
  - `AI_SERVICE_URL` (mặc định: `http://127.0.0.1:8000`)
  - `AI_INTERNAL_SERVICE_TOKEN` (token xác thực giữa Next.js server và FastAPI)
  - `AI_INTERNAL_TELEMETRY_TOKEN` (token xác thực các endpoint telemetry bảo vệ)
- **Tài liệu hóa**: Bổ sung đầy đủ chú thích trong `.env.example` với giá trị rỗng (placeholder), không commit bất kỳ secret thật nào.
- **Bảo mật**: Tuyệt đối không sử dụng tiền tố `NEXT_PUBLIC_` cho bất kỳ token server-to-server nào.

---

## 6. KẾT QUẢ KIỂM THỬ TOÀN DIỆN (FULL VERIFICATION SUITE)

| Bộ kiểm thử | Lệnh thực thi | Kết quả | Chi tiết |
| :--- | :--- | :--- | :--- |
| **Python Tests** | `pytest ai_service/tests -v` | **144 / 144 PASSED** | Kiểm thử Distributed Idempotency simulation, Client Retry Dedup, Separate Actions, Missing/Wrong Token Trust Boundary, Idempotency Key Length <= 128, Schema Columns Alignment, 6 kịch bản Promotion Gate, Warning Audit Metric Consistency, Real-world phrases. |
| **Node Unit Tests** | `npm run test:unit` | **76 / 76 PASSED** | Kiểm thử Supabase Migration 017 SQL Security (Revoke anon/auth, Grant service_role), Database Idempotency Partial Unique Index & Check Constraint, Client Retry Idempotency, Feedback loop V4 isolation, Canary distribution, Security guards. |
| **TypeScript Check** | `npx tsc --noEmit` | **0 ERRORS** | Biên dịch sạch 100%. |
| **Lint** | `npm run lint` | **0 ERRORS** | 7 pre-existing warnings được giữ nguyên. |
| **Next.js & Worker Build** | `npm run build` | **BUILD SUCCESS** | Hoàn thành `build:next` (21 pages static/dynamic) và `build:worker` (Vite RSC/SSR/Client bundle). |
| **Whitespace & Diff** | `git diff --check` | **0 ERRORS** | Không có lỗi whitespace hay conflict marker. |

---

## 7. KẾT LUẬN & TRẠNG THÁI MERGE

- **REAL TRAFFIC PIPELINE & TELEMETRY INTEGRITY**: **PASS**
  - Supabase Telemetry Insert Security: Anon (DENIED), Authenticated (DENIED), Service Role (ALLOWED).
  - Database-level Partial Unique Idempotency: PASS.
  - Database-level Length Constraint (<= 128 chars): PASS.
  - End-to-End Client Event ID & Retry Dedup: PASS.
  - Trust Boundary: PASS (Token sai/thiếu -> classification = allowed, real traffic count = DENIED).
  - Deployment Env Configuration: PASS (.env.example documented, 0 real secrets).
  - Promotion Gate (valid_v4_canary_events >= 500): PASS (chặn thăng cấp tự động, chỉ mở khi đủ 500 valid V4 events).
- **SAFE FOR HUMAN MERGE REVIEW**: **YES** (Sau khi hoàn tất toàn bộ kiểm thử bảo mật, tính toàn vẹn và không tự động merge main).
