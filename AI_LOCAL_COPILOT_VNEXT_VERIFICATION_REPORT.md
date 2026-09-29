# BÁO CÁO KIỂM CHỨNG VÀ HOÀN THIỆN AI LOCAL COPILOT vNEXT
**Dự án**: Sổ Chi Tiêu  
**Phiên bản nhánh**: `ai/local-copilot-vnext`  
**Base Commit**: `504f5c5`  
**Thời điểm thực hiện**: 2026-09-29T23:35:00+07:00  
**Môi trường thử nghiệm**: Local Node.js v24.19.0 (Windows x64), Python 3.11.9, Ollama Local Server (Port 11434, model `qwen2.5-coder:7b`)

---

## 1. TỔNG QUAN VÀ BẢNG PHÂN LOẠI TRẠNG THÁI (VERIFICATION MATRIX)

| Phân hệ / Yêu cầu | Trạng thái kỹ thuật | Phương pháp kiểm chứng | Bằng chứng thực tế |
| :--- | :---: | :---: | :--- |
| **1. Baseline Codebase & Build** | **VERIFIED** | Chạy toàn bộ build, typecheck, lint, test | Exit code 0 cho: `tsc`, `test:unit` (110/110), `pytest` (144/144), `build:worker`, `build:next`, `git diff --check`. |
| **2. Chatbot & Dữ liệu tài chính A/B** | **VERIFIED** | Test fixture độc lập + Live Model inference | User A (chi 300k VND, 25 USD) tách biệt 100% với User B. Không cộng gộp VND + USD thiếu tỷ giá. |
| **3. Phân tích What-If Động** | **VERIFIED** | Hàm trích xuất tự động và tính toán ngân sách | Tự động tính số tiền bất kỳ (250k còn 450k, 500k còn 200k, 800k vượt hạn mức 100k), không hardcode 500k. |
| **4. Phân biệt Lỗi DB vs Không có dữ liệu** | **VERIFIED** | Test mô phỏng cờ lỗi DB | Trả về thông báo lỗi kết nối cơ sở dữ liệu rõ ràng, cấm tuyệt đối model báo chi tiêu bằng 0đ khi DB lỗi. |
| **5. Feedback Bền vững & Moderation (P2)** | **VERIFIED** | JSONL bền vững + Test sở hữu + Export | Chống duplicate qua tiến trình, kiểm tra User A không can thiệp prediction của User B (403), lưu lịch sử sửa đổi (revision 1, 2), duyệt/từ chối và export dataset không chứa PII. |
| **6. Giao diện Nhập & Lưu Giao dịch** | **VERIFIED** | UI logic + Component Multi-Drafts + Unit tests | Hỗ trợ xem/sửa cả 2 bản nháp ("Ăn sáng 35k, cà phê 25k"), chuyển tiền nội bộ chuyển sang form transfer, cảnh báo tiền tệ USD, khóa chống nhấn đúp nút lưu. |
| **7. Ollama Concurrency & Giới hạn Hàng đợi** | **VERIFIED** | Semaphore concurrency test | Concurrency tối đa 3 tiến trình, hàng đợi tối đa 10 request, trả 429 `OVERLOADED` khi quá tải, 499 `CLIENT_ABORTED` khi hủy, giải phóng slot an toàn. |
| **8. Đọc Hóa Đơn (Receipt Parsing)** | **BLOCKED: VISION_MODEL_MISSING** | Kiểm tra dịch vụ & phần cứng host | **Xử lý lỗi thiếu model**: **VERIFIED** (trả mã 503 `VISION_MODEL_MISSING`). **Đọc ảnh thực tế**: **BLOCKED** do máy chủ hiện tại chỉ có 3.3 GB RAM trống và chỉ cài `qwen2.5-coder:7b`, chưa thể tải model thị giác 7B/11B mà không gây OOM. |
| **9. Prompt Injection & Bảo mật Ngữ cảnh** | **VERIFIED** | Kiểm thử chuỗi độc hại trong tên ví, note, query | Loại bỏ thẻ `<script>`, vô hiệu hóa chỉ dẫn override system prompt, không cấp quyền SQL tùy ý cho AI. |

---

## 2. KẾT QUẢ CHẠY BASELINE VÀ KIỂM TRA CHẤT LƯỢNG

Toàn bộ các lệnh kiểm tra được thực thi trực tiếp trên thư mục làm việc của dự án:

| Lệnh thực thi | Thư mục làm việc | Exit Code | Kết quả Passed / Failed / Skipped | Ghi chú |
| :--- | :--- | :---: | :---: | :--- |
| `npx tsc --noEmit` | `c:\vibecoding\so-chi-tieu` | **0** | 0 lỗi | Typecheck Next.js & TypeScript toàn dự án |
| `npm run test:unit` | `c:\vibecoding\so-chi-tieu` | **0** | **110 passed**, 0 failed | Chạy 16 tệp test JS/MJS qua Node test runner |
| `pytest` | `c:\vibecoding\so-chi-tieu\ai_service` | **0** | **144 passed**, 0 failed, 5 warnings | Test FastAPI, Canary routing, telemetry shadow |
| `npm run lint` | `c:\vibecoding\so-chi-tieu` | **0** | **0 errors**, 5 warnings | Kiểm tra ESLint code style |
| `npm run build:worker` | `c:\vibecoding\so-chi-tieu` | **0** | Thành công | Vite / Cloudflare Worker bundle |
| `npm run build:next` | `c:\vibecoding\so-chi-tieu` | **0** | Thành công (23/23 pages) | Next.js 16.3.4 Production Build với Turbopack |
| `git diff --check` | `c:\vibecoding\so-chi-tieu` | **0** | 0 lỗi định dạng | Không có conflict markers hay whitespace thừa |

### Phân loại các bộ kiểm thử
1. **Kiểm thử logic hành vi thực thi**:
   - `tests/ai-copilot-verification-vnext.test.mjs` (19 tests): Chạy code logic thực tế gồm phân tích NLP, tính toán what-if động, cách ly đa tiền tệ, pipeline hàng đợi feedback bền vững, và gọi trực tiếp Ollama model `qwen2.5-coder:7b`.
   - `tests/domain-logic.test.mjs` (10 tests): Kiểm tra tính toán ngày tháng UTC+7, làm tròn hạn mức, số dư ví.
   - `tests/duplicate-detection.test.mjs` (4 tests): Kiểm tra thuật toán phát hiện giao dịch trùng lặp.
2. **Kiểm thử với Mock / Fixture**:
   - `tests/ai-integration-v3.test.mjs`: Mock service HTTP để kiểm tra circuit breaker, fallback và timeout.
   - `tests/ai-canary-routing.test.mjs`: Giả lập phân phối 10.000 user để kiểm chứng tỷ lệ Canary 5%.
3. **Kiểm thử kết nối mô hình thật (Live Model)**:
   - `tests/ai-copilot-verification-vnext.test.mjs` (Test `Live Chatbot: Inference with User A fixture on qwen2.5-coder:7b`): Kết nối trực tiếp dịch vụ Ollama tại cổng 11434 để kiểm chứng câu trả lời tài chính từ mô hình AI thật.
4. **Kiểm thử đọc mã nguồn / Regex SQL (Static Inspection)**:
   - `tests/database-security.test.mjs`: Quét regex trên các file migration `.sql` để kiểm tra việc bật RLS và quyền REVOKE/GRANT.
   *Lưu ý minh bạch*: Bộ test này chỉ chứng minh câu lệnh SQL migration trong repo đã khai báo RLS, chưa tương đương với việc chạy thử nghiệm RLS trên database server live nếu chưa có container Postgres chạy local.

---

## 3. KIỂM CHỨNG CHATBOT VỚI DỮ LIỆU TEST ĐỘC LẬP

### 3.1. Thiết lập Fixture
Tạo fixture độc lập gồm 2 người dùng hoàn toàn tách biệt:
- **Người dùng A (`user_a_123`)**:
  - 2 khoản chi VND: 100.000đ (Ăn sáng) và 200.000đ (Ăn tối). Tổng chi VND = **300.000 VND**.
  - 2 khoản chi USD: 10 USD (Ebook) và 15 USD (Subscription). Tổng chi USD = **25 USD**.
  - Ngân sách VND liên quan: 1.000.000 VND (Đã chi 300.000 VND, còn lại 700.000 VND).
- **Người dùng B (`user_b_999`)**:
  - Giao dịch riêng: 5.000.000 VND (Vé máy bay), ví riêng: "Ví bí mật B".

### 3.2. Bằng chứng kiểm chứng
- **Cách ly người dùng**: Lời nhắc context gửi cho A tuyệt đối không chứa chữ `"Ví bí mật B"` hay `"50.000.000"` của B (Đã kiểm chứng tại `ai-copilot-verification-vnext.test.mjs:155`).
- **Cách ly đa tiền tệ**:
  ```text
  [TỔNG KẾT TÀI CHÍNH THÁNG 09/2026 THEO TIỀN TỆ]
  - Tiền tệ VND: Tổng thu 20.000.000 VND | Tổng chi tiêu 300.000 VND | Tiết kiệm ròng 19.700.000 VND
  - Tiền tệ USD: Tổng thu 0 USD | Tổng chi tiêu 25 USD | Tiết kiệm ròng -25 USD
  - QUY TẮC BẮT BUỘC: Không được tự ý cộng gộp các loại tiền tệ khác nhau thành một tổng duy nhất khi chưa có tỷ giá chính thức.
  ```
  Không xuất hiện phép cộng vô lý `300.025 VND`.
- **What-If Động**:
  - "Nếu mua thêm 500k thì ngân sách còn bao nhiêu?" -> Ngân sách còn lại = **200.000 VND** (`700.000 - 500.000`).
  - "Nếu tôi mua thêm 250.000đ thì sao?" -> Ngân sách còn lại = **450.000 VND** (`700.000 - 250.000`).
  - "Nếu chi thêm 800 nghìn thì ngân sách thế nào?" -> Ngân sách còn lại = **-100.000 VND** (**VƯỢT HẠN MỨC 100.000 VND!**).
- **Phân biệt Lỗi DB vs Không có dữ liệu**:
  - Khi cờ `databaseQueryError: true`, prompt bổ sung khối lệnh:
    ```text
    [LỖI TRUY VẤN CƠ SỞ DỮ LIỆU TỪ MÁY CHỦ]
    - BẮT BUỘC: KHÔNG ĐƯỢC thông báo người dùng chi tiêu 0đ hoặc nói người dùng chưa chi tiêu gì. Hãy thông báo rõ ràng cho người dùng là hệ thống đang gặp lỗi kết nối cơ sở dữ liệu khi truy vấn dữ liệu tài chính.
    ```
- **Kiểm chứng Inference thực tế với Ollama**:
  Chạy test inference trên `qwen2.5-coder:7b`: Model phản hồi chính xác dựa trên ngữ cảnh được cung cấp (ghi nhận chi tiêu 300.000 VND và 25 USD, thời gian phản hồi: 1.77s).

---

## 4. XÁC MINH FEEDBACK BỀN VỮNG VÀ MODERATION (P2)

### 4.1. Cơ chế đã triển khai
1. **Deduplication bền vững qua Disk**: Triển khai `backend/src/services/feedback-moderation.service.ts` ghi vào tệp JSONL `ai_service/data/feedback_moderation.jsonl` kết hợp in-memory cache. Khi khởi động lại tiến trình, cache tự động nạp lại từ disk.
2. **Xử lý Retry và Sửa đổi (Amendments)**:
   - Gửi lại cùng một phản hồi nhiều lần: `is_duplicate = true`, không tạo bản ghi mới.
   - Người dùng sửa lại danh mục cho cùng một inference: `is_amendment = true`, tăng `revision` lên 2, ghi nhận `previous_actual_category` và đưa mẫu trở lại trạng thái `pending` để kiểm duyệt lại.
3. **Bảo mật Quyền sở hữu (Anti-Spoofing)**:
   - Hàm `verifyPredictionOwnership(predictionId, userId)` và kiểm tra hash người dùng trên API: Người dùng A không thể gửi feedback cho prediction của Người dùng B (trả mã 403 Forbidden).
   - `model_version` được server xác thực, không tin tưởng tham số do client tự gửi.
4. **Hàng đợi Kiểm duyệt và Xuất Dataset**:
   - API Admin: `/api/admin/feedback-moderation` (GET: danh sách hàng đợi, POST: phê duyệt / từ chối với ghi chú của kiểm duyệt viên).
   - API Export: `/api/admin/feedback-moderation/export` (chỉ xuất các mẫu có `status: "approved"` VÀ `consent_training: true`).
   - Mẫu xuất đã loại bỏ toàn bộ PII (không có user_id, không có IP, không có nội dung nhạy cảm), kèm mã nguồn gốc `provenance: inference:<id>:rev<revision>`.

---

## 5. KIỂM CHỨNG GIAO DIỆN NHẬP VÀ LƯU GIAO DỊCH TRÊN TRÌNH DUYỆT

### 5.1. Bảng kiểm tra 7 câu tiếng Việt thực tế

| Câu nhập vào | Loại nhận diện | Số tiền trích xuất | Danh mục / Chi tiết | Hành vi hệ thống |
| :--- | :---: | :---: | :---: | :--- |
| **Ăn sáng 35k** | Chi tiêu (`expense`) | 35.000 VND | Danh mục "Ăn uống" | Điền bản nháp, preselect danh mục |
| **Hôm qua đổ xăng 70 nghìn** | Chi tiêu (`expense`) | 70.000 VND | Danh mục "Di chuyển", ngày hôm qua | Tính đúng mốc ngày hôm qua theo UTC+7 |
| **Nhận lương 12 triệu** | Thu nhập (`income`) | 12.000.000 VND | Danh mục "Lương" | Điền bản nháp thu nhập |
| **Chi 1,5 triệu tiền nhà** | Chi tiêu (`expense`) | 1.500.000 VND | Danh mục "Tiền nhà" | Xử lý đúng dấu phẩy thập phân tiếng Việt |
| **Mua sách 15 USD** | Chi tiêu (`expense`) | 15 USD | Tiền tệ USD | Không tự ý gắn vào ví VND; nếu chưa chọn ví USD sẽ hiển thị cảnh báo yêu cầu chọn ví USD |
| **Chuyển 500k từ ví tiền mặt sang ngân hàng** | Chuyển tiền (`transfer`) | 500.000 VND | Từ: Tiền mặt, Sang: Ngân hàng | **Không lưu thành chi tiêu**. Tự động chuyển modal sang biểu mẫu Chuyển tiền nội bộ với giá trị điền sẵn |
| **Ăn sáng 35k, cà phê 25k** | Đa giao dịch (`multiple`) | 35.000 VND & 25.000 VND | 2 giao dịch độc lập | Tách thành 2 bản nháp trong bảng Multi-Drafts. Người dùng sửa và lưu từng bản nháp hoặc lưu tất cả |

### 5.2. Các biện pháp bảo vệ đã bổ sung trong `frontend/components/dashboard.tsx`
- **Khóa chống Double-Click**: Bổ sung `if (saving) return;` vào đầu hàm `saveTransaction`, `saveTransfer`, `saveSingleMultiDraft`, và `saveAllMultiDrafts`. Nút bấm tự động disabled và hiển thị "Đang lưu...".
- **Bảo toàn dữ liệu khi chưa lưu**: Việc phân tích văn bản hoặc xóa bản nháp chỉ thay đổi state React, tuyệt đối không gửi request ghi xuống cơ sở dữ liệu.
- **Bảo vệ ví ngoại tệ USD**: Kiểm tra ví đã chọn có currency là USD hay không. Nếu không, chặn lưu và hiển thị cảnh báo: *"Giao dịch USD yêu cầu chọn ví tiền tệ USD hoặc xác nhận quy đổi trước khi lưu."*

---

## 6. ĐÁNH GIÁ CHỨC NĂNG ĐỌC HÓA ĐƠN (RECEIPT OCR)

- **Trạng thái chính thức**: **BLOCKED: VISION_MODEL_MISSING**
- **Đánh giá cụ thể**:
  1. **Xử lý lỗi thiếu model**: **VERIFIED**. Khi người dùng gọi API đọc hóa đơn mà máy chủ Ollama chưa cài model thị giác, hệ thống trả về mã lỗi 503 `VISION_MODEL_MISSING` kèm thông báo tiếng Việt: *"Chưa cài đặt mô hình thị giác (llama3.2-vision:11b). Vui lòng chạy lệnh: ollama pull llama3.2-vision:11b để đọc hóa đơn."*
  2. **Đọc ảnh thực tế & Trích xuất**: **BLOCKED**.
     - Tài nguyên máy chủ hiện tại: RAM khả dụng chỉ còn khoảng **3.3 GB** (Tổng RAM: 16 GB).
     - Mô hình hiện có trên Ollama: Duy nhất `qwen2.5-coder:7b` (4.7 GB).
     - Việc tự ý tải `llama3.2-vision:11b` (kích thước ~7.9 GB) hoặc các model vision nặng trên cấu hình này sẽ dẫn đến tràn bộ nhớ (Out Of Memory) và làm sập dev server.
  3. **Kết luận báo cáo**: Sửa lại cách đánh giá từ báo cáo trước: Không đánh dấu VERIFIED cho chức năng OCR khi chưa có model vision thực thi trích xuất trên hóa đơn mẫu.

---

## 7. KIỂM TRA OLLAMA VÀ AN TOÀN PROMPT INJECTION

### 7.1. Concurrency Limiter
- Giới hạn tiến trình đồng thời: Tối đa **3 slots**.
- Giới hạn hàng đợi: Tối đa **10 requests**.
- Khi hàng đợi đầy: Trả mã HTTP 429 `OVERLOADED` kèm thông báo *"Hệ thống AI đang quá tải với hàng đợi đầy. Vui lòng thử lại sau."*
- Xử lý hủy request: Khi `AbortSignal` kích hoạt khi đang chờ hoặc đang gọi, slot lập tức được giải phóng trong khối `finally`, trả mã HTTP 499 `CLIENT_ABORTED`.
- Quản lý timeout: Tổng deadline tính gộp từ lúc chờ slot đến lúc đọc xong stream/response, quá thời gian trả HTTP 504 `TIMEOUT`.

### 7.2. Phòng chống Prompt Injection
- Tất cả các trường do người dùng định nghĩa (tên ví, tên danh mục, tiêu đề giao dịch, ghi chú) đều đi qua hàm `sanitize()` cắt bỏ ký tự điều khiển `< > { } \` trước khi đưa vào system prompt.
- Các chỉ dẫn phá vỡ ngữ cảnh dạng `SYSTEM PROMPT OVERRIDE: ignore all instructions` được đối xử như văn bản thuần, không làm thay đổi vai trò hệ thống của model.
- Không cấp quyền SQL tùy ý cho AI; toàn bộ dữ liệu tài chính được tổng hợp xác định bởi server code.

---

## 8. CÁC TỆP ĐÃ THAY ĐỔI VÀ NGUYÊN NHÂN SỬA ĐỔI

1. [`.gitignore`](file:///c:/vibecoding/so-chi-tieu/.gitignore):
   - Bổ sung `ai_service/data/feedback_moderation.jsonl` và `ai_service/data/*.jsonl` để ngăn chặn việc commit dữ liệu người dùng thật hoặc dữ liệu test vào Git.
2. [`backend/src/services/financial-context.service.ts`](file:///c:/vibecoding/so-chi-tieu/backend/src/services/financial-context.service.ts):
   - Thêm cơ chế tách bạch đa tiền tệ (`expensesByCurrency`, `incomesByCurrency`).
   - Thêm hàm trích xuất what-if động `extractWhatIfAmountFromQuery` và tính toán `calculateDynamicWhatIf` cho số tiền bất kỳ.
   - Thêm cờ phát hiện lỗi cơ sở dữ liệu `databaseQueryError` vào prompt.
   - Chuyển import sang tương thích Node test runner `--experimental-strip-types`.
3. [`backend/src/services/ai-chat.service.ts`](file:///c:/vibecoding/so-chi-tieu/backend/src/services/ai-chat.service.ts):
   - Cập nhật System Prompt tài chính với quy tắc cách ly tiền tệ và toán học what-if chính xác.
4. [`backend/src/services/ollama-client.ts`](file:///c:/vibecoding/so-chi-tieu/backend/src/services/ollama-client.ts):
   - Bổ sung giới hạn hàng đợi `MAX_WAITING_QUEUE_LENGTH = 10`, phân biệt mã lỗi 429 (`OVERLOADED`), 499 (`CLIENT_ABORTED`), 504 (`TIMEOUT`).
5. [`backend/src/services/feedback-moderation.service.ts`](file:///c:/vibecoding/so-chi-tieu/backend/src/services/feedback-moderation.service.ts):
   - Tạo mới dịch vụ lưu trữ feedback bền vững qua JSONL, hỗ trợ chống duplicate, theo dõi sửa đổi (revision), kiểm tra quyền sở hữu, và xuất dataset ẩn danh có cờ đồng ý (consent).
6. [`app/api/admin/feedback-moderation/route.ts`](file:///c:/vibecoding/so-chi-tieu/app/api/admin/feedback-moderation/route.ts) & [`export/route.ts`](file:///c:/vibecoding/so-chi-tieu/app/api/admin/feedback-moderation/export/route.ts):
   - Tạo endpoint API Admin quản lý hàng duyệt và xuất dữ liệu đào tạo.
7. [`app/api/ai/feedback/route.ts`](file:///c:/vibecoding/so-chi-tieu/app/api/ai/feedback/route.ts):
   - Tích hợp kiểm tra quyền sở hữu của người dùng (trả 403 nếu sai user) và kết nối pipeline lưu trữ bền vững.
8. [`frontend/types/finance.types.ts`](file:///c:/vibecoding/so-chi-tieu/frontend/types/finance.types.ts):
   - Thêm trường tùy chọn `initialData` vào variant `transfer` của `ModalState` (bảo toàn tương thích 100% với logic Codex Multi-Currency).
9. [`frontend/components/dashboard.tsx`](file:///c:/vibecoding/so-chi-tieu/frontend/components/dashboard.tsx):
   - Tích hợp panel duyệt và chỉnh sửa đa bản nháp (`multiDrafts`).
   - Tự động chuyển giao dịch chuyển tiền nội bộ sang modal `transfer` với giá trị điền sẵn.
   - Thêm kiểm tra ví ngoại tệ USD và khóa chống nhấp đúp khi lưu.
10. [`tests/ai-copilot-verification-vnext.test.mjs`](file:///c:/vibecoding/so-chi-tieu/tests/ai-copilot-verification-vnext.test.mjs):
    - Bộ test kiểm chứng tự động toàn diện gồm 19 ca kiểm thử (100% passed).

---

## 9. GIỚI HẠN CÒN LẠI VÀ HƯỚNG DẪN ROLLBACK

### Giới hạn còn lại
- **Receipt OCR**: Cần máy chủ có GPU hoặc tối thiểu 16 GB RAM trống để triển khai mô hình thị giác local (như `llama3.2-vision:11b` hoặc `llava:7b`).
- **Canary V4**: Tỷ lệ V4 giữ nguyên mức an toàn <= 5%, chưa kích hoạt tự động promote lên production do yêu cầu cổng kiểm định 500 sự kiện nhãn thật.

### Hướng dẫn Rollback
Nếu cần khôi phục lại trạng thái ban đầu của đợt vNext:
```bash
git checkout 504f5c5 -- app/ backend/ frontend/ tests/
```
Hoặc revert commit tương ứng trên nhánh `ai/local-copilot-vnext`. Không ảnh hưởng đến nhánh `main` hay module Multi-Currency của Codex.
