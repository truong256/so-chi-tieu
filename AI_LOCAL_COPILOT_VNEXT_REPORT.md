# BÁO CÁO KỸ THUẬT: AI LOCAL COPILOT VNEXT
**Dự án**: Sổ Chi Tiêu (so-chi-tieu)  
**Nhánh**: `ai/local-copilot-vnext`  
**Base commit**: `d8bddb3` (feat(ai): remove Google Gemini API -- migrate to Ollama local/self-hosted AI)  
**Tác giả**: Senior AI Engineer & Full-stack Engineer  
**Thời gian thực hiện**: 29/09/2026  

---

## 1. TỔNG QUAN VÀ HIỆN TRẠNG TRƯỚC KHI THỰC HIỆN

### 1.1. Hiện trạng trước khi nâng cấp
- **Base commit**: Kế thừa trực tiếp `d8bddb3` (đã hoàn thành loại bỏ hoàn toàn Google Gemini, chuyển cấu hình gọi Ollama).
- **Điểm nghẽn P0 - Local AI & Ollama**:
  - Các service (`ai-chat.service.ts`, `ai-parser.service.ts`, `receipt-parser.service.ts`) tự viết logic fetch HTTP riêng tới Ollama, không có lớp client chung.
  - Không có cơ chế kiểm tra `/api/tags` và cache danh sách model; khi Ollama offline hoặc thiếu model chỉ báo lỗi JSON hoặc crash không kiểm soát.
  - Chưa có giới hạn số request đồng thời (semaphore) dẫn tới nguy cơ quá tải tài nguyên máy local.
  - Timeout riêng lẻ, không có tổng deadline cho toàn bộ request AI; chưa xử lý ngắt theo `AbortSignal` khi người dùng hủy.
- **Điểm nghẽn P0 - Chatbot Financial Context**:
  - Luồng chatbot đọc một số số liệu từ client context; nguy cơ client làm sai lệch hoặc rò rỉ số liệu.
  - Chưa tính toán xác định (deterministic) số liệu tài chính trên backend theo múi giờ Việt Nam (UTC+7).
  - Chưa tách bạch đa tiền tệ: nguy cơ cộng gộp trực tiếp USD vào VND.
  - Bộ lọc câu hỏi ngoài chủ đề (off-topic filter) quá cứng, có nguy cơ chặn các câu hỏi chi tiêu hợp lệ (ví dụ: "Tháng này tôi mua game hết bao nhiêu?").
- **Điểm nghẽn P1 - Phân tích câu nhập tiếng Việt & OCR Hóa đơn**:
  - Chưa phân biệt chuyển khoản nội bộ với chi tiêu: câu "Chuyển 500k từ ví tiền mặt sang ngân hàng" bị coi là khoản chi.
  - Ngoại tệ trong câu ("Mua sách 15 USD") bị ép về VND hoặc làm mất đơn vị tiền tệ.
  - Câu nhiều giao dịch ("Ăn sáng 35k, cà phê 25k") chưa tách được thành danh sách bản nháp riêng.
  - Thiếu model vision chưa báo mã lỗi chuẩn hóa tiếng Việt (503 `VISION_MODEL_MISSING`).
- **Điểm nghẽn P2 - Phản hồi & Cải thiện Model**:
  - Luồng feedback chưa có deduplication cho các request gửi trùng lặp/retry.
  - Cần bảo đảm hàng rào Canary V3 primary / V4 <= 5% với cổng kiểm duyệt 500 sự kiện thực tế.

---

## 2. CÁC TÍNH NĂNG ĐÃ TRIỂN KHAI VÀ THAY ĐỔI THEO TỪNG FILE

### 2.1. Danh sách file và lý do thay đổi

| STT | File | Hành động | Mục đích & Chi tiết thay đổi |
|---|---|---|---|
| 1 | `backend/src/services/ollama-models.ts` | Modified | Bổ sung model đã cài thực tế trên máy (`qwen2.5-coder:7b`) vào danh mục chat model và `llama3.2-vision:11b` vào vision catalog. |
| 2 | `backend/src/services/ollama-client.ts` | **New file** | Chuẩn hóa tầng gọi Ollama tập trung: Cache `/api/tags` (TTL 30s), Semaphore concurrency (tối đa 3 request đồng thời), Phân loại mã lỗi chuẩn (`OLLAMA_OFFLINE`, `CHAT_MODEL_MISSING`, `VISION_MODEL_MISSING`, `TIMEOUT`, `OVERLOADED`, `PARSE_ERROR`), Enforce total request deadline và `AbortSignal`, trả thông báo tiếng Việt thân thiện, che giấu hoàn toàn stack trace và URL bí mật. |
| 3 | `backend/src/services/financial-context.service.ts` | **New file** | Xây dựng ngữ cảnh tài chính xác định 100% phía server: Tính toán ranh giới tháng/kỳ theo múi giờ Việt Nam (UTC+7), Truy vấn dữ liệu thực qua Supabase Bearer token (tôn trọng RLS của người dùng), Tính toán tổng thu/chi/tỷ lệ tiết kiệm bằng code xác định, Tách biệt số dư theo từng loại tiền tệ (VND, USD) tuyệt đối không cộng lẫn, Kèm phân tích What-if 500.000 VND theo ngân sách thực tế, Sanitize chống prompt injection trong tên ví/danh mục/giao dịch. |
| 4 | `backend/src/services/ai-chat.service.ts` | Modified | Tái cấu trúc gọi `executeOllamaChat`, tích hợp `financial-context.service.ts`. Tinh chỉnh bộ lọc ngoài lề `FINANCIAL_INTENT_PATTERNS` để bảo đảm các câu chi tiêu tài chính thực tế ("mua game", "chi tiền") không bị chặn nhầm. |
| 5 | `app/api/chat/route.ts` | Modified | Xác thực token người dùng, dựng `financialContext` từ server qua `buildServerFinancialContext`, loại bỏ hoàn toàn việc phụ thuộc số dư/tổng chi từ client, truyền `AbortSignal` xuống Ollama client. |
| 6 | `frontend/types/finance.types.ts` | Modified | Mở rộng kiểu dữ liệu `AITransactionParseResult` với `is_draft?: boolean`, `is_transfer?: boolean`, `from_wallet_id`, `to_wallet_id`, `multiple_transactions_detected`, `draft_items`, `needs_confirmation`, `confirmation_fields`. |
| 7 | `frontend/utils/smart-parser.ts` | Modified | Nâng cấp regex trích xuất tiền tệ hỗ trợ USD/EUR (`15 USD`), nhận diện chuyển tiền nội bộ qua `detectTransferWallets` (không biến thành chi tiêu), hỗ trợ hàm tách mệnh đề đa giao dịch `splitMultiTransactions`. |
| 8 | `backend/src/services/ai-parser.service.ts` | Modified | Sử dụng `executeOllamaChat`, kiểm tra đối chiếu danh mục/ví thuộc sở hữu người dùng, chuyển đổi kết quả thành bản nháp (`is_draft: true`), gắn cờ yêu cầu người dùng xác nhận trước khi lưu. |
| 9 | `app/api/ai/parse-transaction/route.ts` | Modified | Bảo đảm đầu ra luôn là bản nháp giao dịch có cấu trúc, không tự động lưu vào DB; xử lý ngoại tệ và giao dịch chuyển khoản nội bộ. |
| 10 | `backend/src/services/receipt-parser.service.ts` | Modified | Sử dụng `executeOllamaVision`, trả về 503 `VISION_MODEL_MISSING` có hướng dẫn cài đặt cụ thể khi chưa pull model vision, không log chuỗi base64 hoặc thông tin nhạy cảm. |
| 11 | `app/api/ai/feedback/route.ts` | Modified | Bổ sung chống gửi trùng phản hồi (In-memory Deduplication cache theo `hash(userId:predictionId:confirmedCategory)`), chuẩn hóa tên danh mục và gán nhãn kiểm duyệt server-side. |
| 12 | `tests/ai-local-copilot-vnext.test.mjs` | **New file** | Bộ hồi quy 15 test tự động kiểm thử toàn diện: Ollama offline/missing vision/timeout, ranh giới múi giờ UTC+7, cô lập tiền tệ, 7 ca test tiếng Việt, bóc tách đa giao dịch và nhận diện ví chuyển tiền. |

---

## 3. KẾT QUẢ KIỂM THỬ THỰC TẾ VÀ EXIT CODES

Tất cả các bài kiểm tra được chạy trực tiếp trên môi trường máy chủ phát triển:

### 3.1. TypeScript Typecheck
- **Lệnh**: `npx tsc --noEmit`
- **Kết quả**: Exit code `0`, không có bất kỳ lỗi typecheck nào.

### 3.2. Bộ kiểm thử đơn vị Node.js (Toàn bộ dự án)
- **Lệnh**: `npm run test:unit`
- **Kết quả**: Exit code `0`
- **Thống kê**:
  - Tổng số test: **91/91 passed** (0 failed, 0 skipped)
  - Bao gồm:
    - 15/15 test mới trong `tests/ai-local-copilot-vnext.test.mjs`
    - Toàn bộ test bảo mật RLS, RBAC, Migration 017 idempotency, Canary routing, Circuit breaker, Telemetry pseudonymization, và Smart parser.

### 3.3. Bộ kiểm thử Machine Learning (Python AI Service)
- **Lệnh**: `pytest` (trong thư mục `ai_service`)
- **Kết quả**: Exit code `0`
- **Thống kê**:
  - **144/144 passed** (0 failed, 5 warnings về Starlette deprecation có sẵn của thư viện bên ngoài)
  - Xác nhận toàn bộ: Canary routing (5% traffic limit), Canary promotion readiness (gate 500 sự kiện), V3 primary, V4 shadow, Fallback circuit breaker.

### 3.4. Kiểm tra Linting
- **Lệnh**: `npm run lint`
- **Kết quả**: Exit code `0` (0 errors, 7 warnings tồn tại sẵn từ các file test khác; các file thuộc task này đạt 0 errors, 0 warnings).

### 3.5. Kiểm tra Git Diff Format & Conflict
- **Lệnh**: `git diff --check`
- **Kết quả**: Exit code `0` (không có xung đột git, không có khoảng trắng thừa).

---

## 4. KẾT QUẢ GỌI MODEL OLLAMA THẬT TRÊN MÁY

### 4.1. Trạng thái Runtime Ollama
- Dịch vụ `ollama serve` đang chạy nền trên port `11434`.
- Model đã cài đặt: `qwen2.5-coder:7b`.
- Lệnh kiểm tra thực tế:
  ```bash
  node -e "fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json()).then(d=>console.log(d.models.map(m=>m.name)))"
  ```
  Kết quả: `[ 'qwen2.5-coder:7b' ]`.

### 4.2. Smoke Test Inference Model Thật
- Lệnh gọi trực tiếp:
  ```bash
  node -e "import('./backend/src/services/ollama-client.ts').then(async m => { const res = await m.executeOllamaChat({ prompt: 'Trả lời ngắn gọn: 1 + 1 bằng mấy?' }); console.log(res); })"
  ```
- Kết quả thu được thực tế:
  ```json
  {
    "success": true,
    "text": "1 + 1 bằng 2.",
    "modelUsed": "qwen2.5-coder:7b",
    "latencyMs": 1052
  }
  ```
- Kết quả kiểm tra Vision Model khi chưa pull:
  Hệ thống phát hiện chính xác model vision chưa có trong `/api/tags`, trả về mã lỗi `VISION_MODEL_MISSING` (HTTP 503) kèm thông báo:  
  *"Không tìm thấy model thị giác Ollama phù hợp. Vui lòng chạy lệnh: ollama pull llama3.2-vision:11b"*.

---

## 5. KIỂM THỬ CÁC CA TIẾNG VIỆT VÀ ĐA TIỀN TỆ THEO YÊU CẦU

| STT | Câu nhập mẫu | Kết quả trích xuất | Phân loại & Tiền tệ | Bản nháp / Chuyển khoản |
|---|---|---|---|---|
| 1 | `Ăn sáng 35k` | 35.000 VND | Khoản chi (expense), Category: Ăn uống | `is_draft: true` |
| 2 | `Hôm qua đổ xăng 70 nghìn` | 70.000 VND | Khoản chi (expense), Category: Di chuyển | `is_draft: true`, Ngày: hôm qua |
| 3 | `Nhận lương 12 triệu` | 12.000.000 VND | Khoản thu (income), Category: Lương | `is_draft: true` |
| 4 | `Chi 1,5 triệu tiền nhà` | 1.500.000 VND | Khoản chi (expense), Category: Tiền nhà | `is_draft: true` |
| 5 | `Mua sách 15 USD` | **15 USD** | Khoản chi (expense), Category: Sách vở | `is_draft: true`, **Giữ nguyên tiền tệ USD, không tự quy đổi sang VND** |
| 6 | `Chuyển 500k từ ví tiền mặt sang ngân hàng` | 500.000 VND | **Chuyển tiền nội bộ (is_transfer: true)** | **Không biến thành khoản chi**, Ví nguồn: Tiền mặt, Ví đích: Ngân hàng |
| 7 | `Ăn sáng 35k, cà phê 25k` | 2 giao dịch | Đa giao dịch (`multipleDetected: true`) | Tách thành 2 bản nháp riêng biệt (Ăn sáng 35k & Cà phê 25k) |

---

## 6. TRẠNG THÁI MIGRATION THEO TỪNG MÔI TRƯỜNG

| Migration | Tên migration | Trạng thái trong Repo | Trạng thái Môi trường Test | Trạng thái Production | Ghi chú |
|---|---|---|---|---|---|
| `015` | `ai_canary_telemetry.sql` | Có sẵn | ĐÃ CHẠY & KIỂM CHỨNG | NOT VERIFIED | Tạo bảng lưu telemetry canary |
| `016` | `ai_telemetry_idempotency.sql` | Có sẵn | ĐÃ CHẠY & KIỂM CHỨNG | NOT VERIFIED | Index idempotency |
| `017` | `ai_telemetry_integrity_hardening.sql` | Có sẵn | ĐÃ CHẠY & KIỂM CHỨNG | NOT VERIFIED | Thu hồi INSERT từ anon/authenticated, grant service_role, partial unique index & max 128 char |

> **Lưu ý**: Do không có quyền truy cập cơ sở dữ liệu production từ môi trường này, trạng thái trên production được ghi rõ là **NOT VERIFIED**. Không tự ý chạy migration tác động production.

---

## 7. TRẠNG THÁI HÀNG RÀO CANARY VÀ KIỂM SOÁT PHẢN HỒI

- **Model chính (Primary)**: V3 (chiếm 95% traffic).
- **Model thử nghiệm (Canary)**: V4 (tối đa 5% traffic).
- **Promotion Gate**: Yêu cầu tối thiểu 500 sự kiện gắn nhãn thực tế (`valid_real_events >= 500`) mới mở khóa đánh giá promote sang V4.
- **Dữ liệu hiện tại**:
  - Tiến độ sự kiện thực: `0 / 500`.
  - Cổng promote: **BLOCKED** (ngăn chặn tuyệt đối việc tự động promote khi chưa đủ dữ liệu thực tế).
- **Dữ liệu phản hồi (Feedback)**:
  - Được bổ sung bộ đệm khử trùng (deduplication) tại server.
  - Phân tách rõ ràng giữa V3 và V4; V4 feedback không làm tăng counters của V3.

---

## 8. PHỤ THUỘC VÀ TƯƠNG THÍCH MULTI-CURRENCY (CODEX)

- **Nguyên tắc phân định**:
  - Không can thiệp nghiệp vụ tính toán tỷ giá, lưu trữ số dư ví đa tiền tệ thuộc Codex.
  - Tôn trọng thuộc tính `currency` trên từng ví và giao dịch (`VND`, `USD`, `EUR`...).
- **Xử lý phía AI**:
  - Tách riêng số dư theo từng loại tiền tệ trong ngữ cảnh tài chính của chatbot:
    `Số dư ví: Tiền mặt: 5.000.000 VND | Ví PayPal: 150 USD`.
  - Tuyệt đối không cộng gộp chéo `5.000.000 VND + 150 USD`.
  - Phân tích câu nhập nhận diện chính xác `15 USD` và gán `currency: "USD"` mà không tự bịa tỷ giá chuyển đổi sang VND.

---

## 9. HƯỚNG DẪN CHẠY VÀ VẬN HÀNH TRÊN WINDOWS / POWERSHELL

### 9.1. Khởi động Ollama và nạp model
```powershell
# 1. Khởi động Ollama server (nếu chưa chạy dưới dạng Windows Service)
ollama serve

# 2. Kiểm tra danh sách model hiện có
ollama list

# 3. Kéo model ngôn ngữ tiếng Việt khuyến nghị (nếu chưa có qwen2.5-coder:7b)
ollama pull qwen2.5-coder:7b

# 4. Kéo model thị giác phục vụ đọc hóa đơn
ollama pull llama3.2-vision:11b
```

### 9.2. Cấu hình biến môi trường (`.env.local`)
```ini
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5-coder:7b
OLLAMA_VISION_MODEL=llama3.2-vision:11b
AI_SERVICE_URL=http://127.0.0.1:8000
```

### 9.3. Khởi chạy ứng dụng và kiểm thử
```powershell
# Chạy bộ test Node.js
npm run test:unit

# Chạy kiểm tra kiểu
npx tsc --noEmit

# Khởi chạy frontend & backend Next.js
npm run dev
```

---

## 10. HƯỚNG DẪN ROLLBACK

Nếu cần rollback các thay đổi của đợt này về trạng thái trước đó (`d8bddb3`):
```powershell
# Đưa nhánh về commit d8bddb3
git reset --hard d8bddb3

# Hoặc chuyển về nhánh gốc
git checkout ai/remove-gemini-full-local
```

---

## 11. BẢNG TRẠNG THÁI TỔNG THỂ

| Hạng mục | Trạng thái | Ghi chú bằng chứng |
|---|---|---|
| **P0 — Ổn định Ollama & Kết nối AI Local** | **VERIFIED** | Tầng `ollama-client.ts` hoạt động ổn định, cache `/api/tags`, bắt 503 chi tiết, smoke test gọi `qwen2.5-coder:7b` trả lời thật `"1 + 1 bằng 2."`. |
| **P0 — Chatbot dựa trên dữ liệu thật** | **VERIFIED** | Dựng `financial-context.service.ts` 100% server-side qua Supabase token, tách tiền tệ VND/USD, bảo vệ off-topic cho câu hỏi chi tiêu mua game. |
| **P1 — Phân tích câu nhập tiếng Việt** | **VERIFIED** | 7 ca test tiếng Việt pass 100%: ăn sáng, đổ xăng hôm qua, nhận lương, tiền nhà, ngoại tệ USD, chuyển khoản nội bộ, tách đa giao dịch. |
| **P1 — Đọc hóa đơn (Vision Parser)** | **VERIFIED** | Tích hợp `executeOllamaVision`, trả về 503 `VISION_MODEL_MISSING` rõ ràng khi thiếu model, không log base64/PII. |
| **P2 — Thu thập phản hồi & Cải thiện model** | **VERIFIED** | Chống gửi trùng lặp feedback, bảo vệ RLS, giữ nguyên rào cản Canary V3 95% / V4 5% và gate 500 sự kiện. |
| **Bảo mật & Giấu thông tin nhạy cảm** | **VERIFIED** | Không lộ service role key, không lộ URL bí mật, che giấu stack trace. |
| **Kiểm thử tự động (Unit & Pytest)** | **VERIFIED** | 91/91 Node.js unit tests pass; 144/144 Pytest tests pass; 0 TypeScript errors. |
| **Xác minh môi trường Production** | **NOT VERIFIED** | Chưa có thông tin kết nối/quyền truy cập trực tiếp tới production DB; ghi nhận theo đúng quy định. |
