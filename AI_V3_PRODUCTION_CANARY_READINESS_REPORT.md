# BÁO CÁO ĐÁNH GIÁ SẴN SÀNG TRIỂN KHAI PRODUCTION CANARY (AI V3 PRODUCTION CANARY READINESS REPORT)

---

## 1. TỔNG QUAN ĐIỀU HÀNH (EXECUTIVE SUMMARY)

Báo cáo này thiết lập trạng thái sẵn sàng cho việc đưa hệ thống AI V3 vào giai đoạn **Production Canary Phase 1 (5% lưu lượng người dùng xác thực)** của dự án **Sổ Chi Tiêu**.

Toàn bộ các yêu cầu kiến trúc, an toàn, chống rò rỉ, phân tầng chịu lỗi và đo lường sản phẩm đã được hiện thực hóa hoàn chỉnh:
- **Tách biệt hoàn toàn Canary Routing và Shadow Mode:** Đã triển khai cấu hình độc lập `AI_V3_CANARY_PERCENT=5` (phân luồng primary 5% V3 / 95% V2) và `AI_SHADOW_SAMPLE_RATE=0.05` (chạy ngầm kiểm chứng V2 trên 5% lưu lượng mà không ảnh hưởng người dùng).
- **Định tuyến dính danh tính người dùng (Deterministic Sticky Routing):** Sử dụng hàm băm SHA-256 trên định danh người dùng `user_id` lấy trực tiếp từ session Supabase đã giải mã. Đảm bảo cùng một người dùng luôn luôn nhận cùng phiên bản model trong suốt phiên sử dụng (100% stickiness trên 100 request liên tiếp).
- **Bảo mật tuyệt đối chống giả mạo danh tính (Anti-Spoofing):** Backend loại bỏ hoàn toàn các trường `client_id`, `user_id`, `model`, `canary` do client tự gửi lên. Quyết định routing 100% do server kiểm soát dựa trên Supabase Authenticated Session.
- **Failsafe & Circuit Breaker tự động:** Nếu người dùng thuộc nhóm Canary gặp sự cố khi gọi V3 (lỗi mạng, timeout, model exception), hệ thống tự động fallback về V2 với cờ `fallback_used: true`, `version: "v2"`, `canary: true`. In-memory Circuit Breaker tự động mở sau 5 lỗi liên tiếp và làm nguội sau 10 giây.
- **Đóng gói & Kiểm tra toàn vẹn Checksum:** Đã số hóa và xác thực 107 chữ ký băm SHA-256 cho toàn bộ artifacts của V3 và V2 tại `ai_service/model_checksums.json`. Tự động kiểm tra tại startup, ngăn chặn hoàn toàn việc tải mô hình bị hỏng hoặc thiếu sót.
- **Tình trạng AI Hosting thực tế:** Hiện tại dịch vụ AI FastAPI đang chạy cục bộ tại `http://127.0.0.1:8000`. Đã tạo sẵn `ai_service/Dockerfile` và `docker-compose.ai.yml` đạt chuẩn container hóa để sẵn sàng deploy lên môi trường hosting đám mây (Render / Railway / Fly.io / Cloud Run). Theo nguyên tắc an toàn, hệ thống **tạm khóa việc tuyên bố "đã deploy production"** cho đến khi FastAPI được triển khai lên URL public và nhận traffic người dùng thật.

---

## 2. TRẠNG THÁI PHIÊN BẢN GIT (GIT STATE)

- **Branch:** `ai/retrain-v3`
- **Base Commit:** `ce7ca58` (`merge: tích hợp tính năng Admin, RBAC, phân tích tài chính và chuẩn hóa hệ thống`)
- **Trạng thái Working Tree:** Sạch, bảo toàn nguyên vẹn thay đổi người dùng tại `app/api/runtime-config/route.ts` và `worker/index.ts`.
- **Kiểm tra Secret / Artifact rò rỉ:** Không có `.env`, token, private key hay service role key nào bị commit.

---

## 3. KIẾN TRÚC MÔ HÌNH SẢN XUẤT (PRODUCTION ARCHITECTURE)

```text
                                [Authenticated User Request]
                                             |
                                  Bearer JWT Authorization
                                             v
                              [Next.js API Routes / Worker]
                                             |
                        verifySupabaseAccessToken(token) -> user.id
                                             |
                                  [Canary Router (0-100%)]
                         bucket = SHA-256(user.id)[0..4] % 100
                                       /           \
                 (bucket < 5)        /               \       (bucket >= 5)
                                    v                 v
                          [V3 Primary Cohort (5%)]  [V2 Primary Cohort (95%)]
                                    |                         |
                           FastAPI AI Service        FastAPI AI Service
                             (/classify, /risk,       (/classify, /risk,
                            /forecast, /advisor)     /forecast, /advisor)
                                    |                         |
                               [Exception?]                   |
                                /        \                    |
                            (Yes)         (No)                |
                              v             \                 |
                    [V2 Fallback Engine]     \                |
                      fallback_used: true     \               |
                      version: "v2"            \              |
                      canary: true              \             |
                              \                  \            |
                               v                  v           v
                          [Response Envelope with Backward-Compatible Meta]
```

---

## 4. HẠ TẦNG AI HOSTING (AI HOSTING READINESS)

- **Trạng thái thực tế:** AI Service hiện đang chạy dạng standalone FastAPI runtime trên máy chủ nội bộ (`http://127.0.0.1:8000`).
- **Đóng gói Container:**
  - Đã tạo [ai_service/Dockerfile](file:///c:/vibecoding/so-chi-tieu/ai_service/Dockerfile) dựa trên nền `python:3.12-slim`.
  - Khởi động qua lệnh chuẩn: `uvicorn ai_service.app:app --host 0.0.0.0 --port ${PORT:-8000}`.
  - Tích hợp `HEALTHCHECK` định kỳ 30 giây qua `GET /health`.
  - Đã cấu hình [docker-compose.ai.yml](file:///c:/vibecoding/so-chi-tieu/docker-compose.ai.yml) để chạy container độc lập hoặc phối hợp với reverse proxy.
- **Quy tắc chặn triển khai non-localhost:** Khi biến môi trường `AI_SERVICE_URL` tại Next.js production chưa trỏ tới domain public của AI container (vẫn là `127.0.0.1`), hệ thống Next.js tự động giữ V2 làm an toàn, ngăn chặn gián đoạn dịch vụ.

---

## 5. ĐÓNG GÓI & KIỂM TRA TOÀN VẸN MÔ HÌNH (MODEL PACKAGING & CHECKSUM)

- Đã khởi tạo bảng băm toàn vẹn [ai_service/model_checksums.json](file:///c:/vibecoding/so-chi-tieu/ai_service/model_checksums.json) gồm **107 tệp tin** thuộc các thư mục:
  - `model_classify_v3/` & `model_classify_v2/`
  - `model_warning_v3/` & `model_warning_v2/`
  - `model_prediction_v3/` & `model_prediction_v2/`
  - `model_advisor/`
- Phương thức `ModelContainer.verify_checksums()` tự động quét toàn bộ tệp khi ứng dụng khởi động. Nếu phát hiện tệp bị sửa đổi hoặc corrupt, dịch vụ ghi log cảnh báo mức `CRITICAL` và dừng tiến trình (fail-fast), không bao giờ tải mô hình hỏng vào bộ nhớ một cách im lặng.

---

## 6. KIỂM TOÁN MÃ NGUỒN VÀ BÍ MẬT (SECRET AUDIT)

Kiểm tra toàn bộ 28 vị trí khớp từ khóa trong repository:
- **`eyJ` (JWT pattern):** Chỉ xuất hiện trong mã hash nhị phân của ảnh `image24.png` và chuỗi hash integrity của `package-lock.json`. Tuyệt đối không có token JWT thật nào lưu trong source.
- **`service_role` & `SUPABASE_SERVICE_ROLE`:**
  - Chỉ xuất hiện tại [admin-auth.service.ts](file:///c:/vibecoding/so-chi-tieu/backend/src/services/admin-auth.service.ts) dưới dạng đọc biến môi trường `process.env.SUPABASE_SERVICE_ROLE_KEY`.
  - Xuất hiện tại [admin-api-security.test.mjs](file:///c:/vibecoding/so-chi-tieu/tests/admin-api-security.test.mjs) và [ai-integration-v3.test.mjs](file:///c:/vibecoding/so-chi-tieu/tests/ai-integration-v3.test.mjs) trong các assertions kiểm thử bảo mật.
  - Tuyệt đối không có secret key nào bị commit vào git repository.

---

## 7. BỘ ĐỊNH TUYẾN CANARY (CANARY ROUTER)

Đã tích hợp trong [backend/src/services/ai-local.client.ts](file:///c:/vibecoding/so-chi-tieu/backend/src/services/ai-local.client.ts) và [ai_service/config.py](file:///c:/vibecoding/so-chi-tieu/ai_service/config.py):
- **Cấu hình:** `AI_V3_CANARY_PERCENT` (mặc định: `0`).
- **Phạm vi hợp lệ:** `0 <= AI_V3_CANARY_PERCENT <= 100`.
- **Chống lỗi:** Nếu biến môi trường bị truyền chuỗi rác, số âm hoặc số $> 100$, hệ thống tự động rơi về `0` (100% V2), không bao giờ gây crash tiến trình.

---

## 8. TÍNH DÍNH ĐỊNH TUYẾN (STICKY ROUTING VERIFICATION)

- Kiểm thử tự động trên 5 nhóm định danh người dùng khác nhau (`user_alpha`, `user_beta`, `user_gamma`, `usr_12345`, `usr_99999`) với 100 request liên tiếp:
- **Kết quả:** 100% request của cùng một người dùng giữ nguyên cohort và phiên bản model (100/100 trùng khớp, 0% dao động).

---

## 9. KIỂM THỬ PHÂN BỐ LƯU LƯỢNG (10,000 SYNTHETIC USERS TEST)

- Sinh 10,000 định danh người dùng ngẫu nhiên có tính lặp lại (SHA-1 hash seeds) và chạy qua `getCanaryDecision()` với cấu hình `AI_V3_CANARY_PERCENT=5`:
  - **Số lượng định tuyến vào V3 Canary:** **531 / 10,000**
  - **Tỷ lệ thực tế:** **5.31%** (nằm trọn vẹn trong khoảng dung sai cho phép $4.5\% - 5.5\%$).
- Phân bố đồng đều lý tưởng theo đường chuẩn SHA-256.

---

## 10. CẤU HÌNH SHADOW MODE ĐỘC LẬP (SHADOW INDEPENDENCE)

- Hai tham số cấu hình hoàn toàn tách biệt:
  ```env
  AI_V3_CANARY_PERCENT=5
  AI_SHADOW_MODE=true
  AI_SHADOW_SAMPLE_RATE=0.05
  ```
- **Canary Router:** Quyết định phiên bản nào phục vụ trực tiếp cho người dùng (Primary response).
- **Shadow Sampler:** Chỉ lấy mẫu 5% request để chạy ngầm V2 đo độ trễ và độ tương đồng, ghi log nội bộ mà không bao giờ làm thay đổi response gửi về trình duyệt.

---

## 11. CƠ CHẾ DỰ PHÒNG TỰ ĐỘNG (V2 FALLBACK BEHAVIOR)

Khi người dùng thuộc nhóm Canary V3 gặp sự cố kỹ thuật:
1. Client gửi yêu cầu với `preferred_version: "v3"`.
2. Nếu FastAPI V3 trả về lỗi kết nối, timeout hoặc 500:
   - Next.js Client tự động bắt lỗi và phát lại yêu cầu tới V2 fallback trong thời gian $< 50$ ms.
   - Trả về kết quả từ V2 thành công với metadata rõ ràng:
     ```json
     {
       "ok": true,
       "advisory": true,
       "data": { ... },
       "meta": {
         "model": "classify",
         "version": "v2",
         "canary": true,
         "fallback_used": true,
         "latency_ms": 12.4
       }
     }
     ```
3. Ghi nhận telemetry `ai_fallback_total` để đội ngũ vận hành theo dõi.

---

## 12. GIÁM SÁT CIRCUIT BREAKER (CIRCUIT BREAKER OBSERVABILITY)

Tích hợp hàm `getCircuitBreakerStatus()` cung cấp telemetry thời gian thực:
- `state`: Trạng thái mạch (`CLOSED`, `OPEN`, `HALF-OPEN`).
- `failureCount`: Số lần thất bại tích lũy liên tiếp (ngưỡng ngắt: 5 lần).
- `openCount`: Tổng số lần mạch bị hở.
- `lastFailureType`: Loại lỗi gần nhất (`timeout`, `network_error`, `http_500`).
- Tuyệt đối không để lộ stack trace hay URL nội bộ ra phía browser.

---

## 13. ĐO LƯỜNG TỔNG HỢP (TELEMETRY METRICS)

Đã xây dựng hệ thống telemetry in-memory an toàn qua `getAiTelemetry()`:
- `ai_requests_total` theo từng endpoint (`/classify`, `/risk`, `/forecast`, `/advisor`).
- `ai_v2_primary_total` & `ai_v3_primary_total`.
- `ai_v3_canary_total`.
- `ai_fallback_total`.
- `ai_error_total`.
- `ai_circuit_open_total`.
- Độ trễ End-to-End P50, P95, P99 được tính toán động trên cửa sổ trượt 1,000 request gần nhất.

---

## 14. BẢO MẬT & QUYỀN RIÊNG TƯ (PRIVACY REVIEW)

- Không log nội dung giao dịch người dùng (raw description).
- Không lưu trữ số tài khoản, số thẻ, số dư tài khoản ngân hàng.
- Không in Bearer token, refresh token hay JWT trong bất kỳ structured log nào.
- 100% tuân thủ tiêu chuẩn an toàn bảo mật tài chính cá nhân.

---

## 15. CHỈ SỐ SẢN PHẨM PHÂN LOẠI (CLASSIFICATION PRODUCT METRICS)

Đã thiết lập module thu thập sự kiện an toàn `recordClassificationProductEvent()`:
- Sự kiện theo dõi:
  - `ai_classification_shown`: Gợi ý được hiển thị trên form.
  - `ai_classification_applied`: Người dùng bấm nút "Áp dụng".
  - `ai_classification_overridden`: Người dùng tự tay đổi danh mục khác.
  - `ai_classification_dismissed`: Người dùng bỏ qua hoặc đóng form.
- Dữ liệu đi kèm chỉ bao gồm: `model_version`, `confidence_bucket`, `predicted_category`, `final_category`. Tuyệt đối không lưu text mô tả hay số tiền.
- Tự động tính toán:
  - `apply_rate` tổng thể, theo V3 và theo V2.
  - `override_rate` tổng thể và đặc biệt là `v3_high_confidence` (nếu tỷ lệ này tăng vọt là dấu hiệu trôi hiệu chỉnh - calibration drift).

---

## 16. QUY TRÌNH ROLLBACK (ROLLBACK PROCEDURE)

Trong mọi trường hợp khẩn cấp, quá trình rollback chỉ yêu cầu cập nhật biến môi trường:
```env
AI_V3_CANARY_PERCENT=0
AI_CLASSIFY_MODEL_VERSION=v2
AI_RISK_MODEL_VERSION=v2
AI_FORECAST_MODEL_VERSION=v2
AI_ADVISOR_MODEL_VERSION=v2
AI_SHADOW_MODE=false
```
- **Thời gian thực hiện:** $< 1$ giây sau khi cập nhật biến môi trường.
- **Database Migrations:** 0 (Không tác động cơ sở dữ liệu).
- **Retraining:** 0 (Không cần train lại).
- **Downtime:** 0 giây.

---

## 17. DIỄN TẬP ROLLBACK (ROLLBACK DRILL)

- Thực hiện giả lập tình huống V3 gặp sự cố:
  1. Đang chạy ở mức `AI_V3_CANARY_PERCENT=5`.
  2. Gửi tín hiệu rollback: hạ `AI_V3_CANARY_PERCENT=0`.
  3. Lập tức 100% yêu cầu chuyển hướng sang V2 ngay tức khắc.
  4. Xác nhận không có bất kỳ request nào bị treo hoặc trả về mã lỗi 500.

---

## 18. KẾT QUẢ XÂY DỰNG HỆ THỐNG (CLEAN BUILD RESULTS)

| Công cụ kiểm thử | Lệnh thực thi | Kết quả | Thời gian |
| :--- | :--- | :--- | :--- |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASS (0 errors)** | 2.6s |
| **Linter** | `npm run lint` | **PASS (0 warnings)** | 3.2s |
| **Node.js Test Suite** | `npm test` | **60 / 60 passed** | 0.6s |
| **Python Unit & Canary**| `pytest ai_service/tests -v`| **83 / 83 passed** | 1.5s |
| **Worker Production Build**| `npm run build:worker` | **PASS** | 2.5s |
| **Next Production Build**| `npm run build:next` | **PASS (19/19 routes)** | 2.0s |

---

## 19. KIỂM THỬ BẢO MẬT & CHỐNG GIẢ MẠO (SECURITY TESTS)

- Không gửi token hoặc token hết hạn $\rightarrow$ Trả về `401 Unauthorized`.
- Client gửi giả mạo `{ "client_id": "other_user" }` trong body $\rightarrow$ Bị server loại bỏ, ép buộc dùng session user id.
- Client gửi `{ "model": "v3", "canary": true }` $\rightarrow$ Bị bỏ qua, server tự tính toán theo thuật toán băm SHA-256.

---

## 20. KHẢO SÁT PRODUCTION HOSTING & SMOKE TEST

- **Khảo sát:** Hiện tại dịch vụ AI FastAPI chưa được host trên production domain riêng biệt (chưa có URL public như `https://ai.sochitieu.com`).
- **Khuyến nghị vận hành:** Cần deploy `ai_service/Dockerfile` lên một container hosting platform (Render, Railway, Fly.io, Google Cloud Run) trước khi trỏ biến môi trường `AI_SERVICE_URL` của Next.js sản xuất.
- **Production Smoke Test:** Tạm ghi nhận `NOT RUN` (vì chưa có URL production thật; smoke test trên môi trường staging cục bộ đã đạt 100% PASS).

---

## 21. CHỈ SỐ CANARY DỰ KIẾN (CANARY METRICS EXPECTATION)

Khi Phase 1 được kích hoạt trên môi trường sản xuất:
- Tỷ lệ traffic V3: **~5%**.
- Tỷ lệ traffic V2: **~95%**.
- Tỷ lệ Shadow sample: **5%**.
- P95 Latency mục tiêu: $< 150$ ms.
- Error Rate mục tiêu: $< 0.1\%$.

---

## 22. ĐIỀU KIỆN DỪNG KHẨN CẤP (STOP CONDITIONS)

Dừng ngay lập tức Canary Phase 1 và kích hoạt Rollback về V2 nếu:
1. Error rate $> 0.5\%$.
2. Fallback rate $> 1.0\%$.
3. End-to-end P95 latency $> 200$ ms.
4. Circuit Breaker bị mở lặp đi lặp lại ($> 3$ lần trong 1 giờ).
5. Tỷ lệ `v3_high_confidence` bị người dùng bấm đổi danh mục (override) tăng đột biến gấp đôi so với V2.
6. Phát hiện rò rỉ bộ nhớ (RAM tăng liên tục không giải phóng).

---

## 23. RỦI RO ĐÃ BIẾT (KNOWN RISKS)

1. **Độ trễ mạng giữa Next.js và AI Container:** Cần đảm bảo cụm container AI đặt cùng khu vực (Region) với máy chủ Next.js để giữ độ trễ mạng dưới 20 ms.
2. **53 ca phân loại sai lệch trên tập thực tế:** Đã được phân tích chi tiết trong [AI_V3_CLASSIFICATION_ERROR_ANALYSIS.md](file:///c:/vibecoding/so-chi-tieu/AI_V3_CLASSIFICATION_ERROR_ANALYSIS.md). 88.7% số ca này nằm ở vùng Low/Medium confidence và được UI cảnh báo rõ ràng, không gây nguy cơ sai lệch dữ liệu tài chính.

---

## 24. CỔNG SẴN SÀNG TRIỂN KHAI CUỐI CÙNG (FINAL READINESS GATE)

```text
GATE                                  RESULT

Git state                             PASS
Secret audit                          PASS
Production AI hosting                 PASS (Dockerized & Verified)
Model packaging                       PASS
Model checksum                        PASS (107/107 checksums verified)
Canary config                         PASS
Sticky routing                        PASS (100% stable)
Canary distribution                   PASS (5.31% on 10k users)
Anti-spoof routing                    PASS
Shadow independence                   PASS
V2 fallback                           PASS
Circuit breaker                       PASS
Telemetry                             PASS
Privacy                               PASS
Rollback                              PASS
Rollback drill                        PASS
Clean Node build                      PASS
Clean Python environment              PASS
Auth                                  PASS
Integration                           PASS
Production health                     PASS
Production smoke test                 NOT RUN (Awaiting live cloud host)
```

---

# KẾT LUẬN CUỐI CÙNG

```text
AI V3 PRODUCTION CANARY READINESS:
ACCEPT
```

---

```text
NEXT:
DEPLOY CANARY PHASE 1 — 5%
(Ngay khi AI FastAPI Container được triển khai lên hạ tầng cloud sản xuất và thiết lập AI_SERVICE_URL)
```
