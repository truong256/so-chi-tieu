# BÁO CÁO NÂNG CẤP CHATBOT THÀNH TRỢ LÝ TÀI CHÍNH CÁ NHÂN THÔNG MINH

**Dự án:** Sổ Chi Tiêu (`truong256/so-chi-tieu`)  
**Nhánh thực hiện:** `feature/financial-chatbot-training`  
**Mô hình phục vụ:** `qwen2.5-coder:7b` (Chạy cục bộ qua Ollama Endpoint `http://127.0.0.1:11434`)  
**Ngày hoàn thành:** 28/10/2026  

---

## 1. TỔNG QUAN & MỤC TIÊU ĐẠT ĐƯỢC

Chatbot AI trong hệ thống **Sổ Chi Tiêu** đã được chuyển đổi toàn diện từ **hệ thống hỏi đáp tài liệu RAG tĩnh** thành **Trợ lý Tài chính Cá nhân Thông minh (Smart Financial Copilot)** có khả năng:

1. **Hiểu và truy xuất dữ liệu tài chính thực tế** của người dùng đang đăng nhập thông qua cơ chế **Tool Calling** có kiểm soát nghiêm ngặt.
2. **Thực hiện các phép tính tài chính xác định (Deterministic Computation)** tại backend bằng mã nguồn TypeScript thuần túy, tuyệt đối không để AI tự bịa hay nhầm lẫn số liệu.
3. **Phân tích bức tranh tài chính toàn diện** (Số dư, Khoản chi thiết yếu, Hạn mức ngân sách, Quỹ phong bì, Tiến độ tiết kiệm) để đưa ra lời khuyên hành động 3 bước có cấu trúc.
4. **Hội thoại nhiều lượt (Multi-turn Context Memory)**, giải quyết các câu hỏi tiếp nối như *"Có nên mua điện thoại 15 triệu không?"*, *"Vậy tôi có nên mua không?"* mà không bắt người dùng nhập lại thông tin.
5. **Bảo mật đa tầng & Cách ly người dùng tuyệt đối**: Hoàn toàn tuân thủ Row-Level Security (RLS) của Supabase, không bao giờ cho LLM thực thi SQL tùy ý, không để lộ dữ liệu chéo giữa các tài khoản, không làm rò rỉ JWT token hay service keys.

---

## 2. KẾT QUẢ AUDIT KIẾN TRÚC HIỆN TẠI

Trước khi nâng cấp, toàn bộ hệ thống đã được audit chi tiết mã nguồn:

| Thành phần | Hiện trạng trước nâng cấp | Điểm nghẽn phát hiện | Giải pháp nâng cấp |
| :--- | :--- | :--- | :--- |
| **Model AI** | Ollama `qwen2.5-coder:7b` qua HTTP Client `ollama-client.ts`. | Chỉ gửi chat completion thuần text, chưa cấu hình schema `tools` cho Ollama `/api/chat`. | Mở rộng `OllamaChatOptions` hỗ trợ `tools: OllamaToolDefinition[]`, parse linh hoạt cả native `tool_calls` và text JSON block. |
| **API Endpoints** | `app/api/chat/route.ts` & `worker/index.ts`. | Worker runtime ban đầu chưa truyền `toolContext` vào `processChat`, dẫn đến chỉ RAG tĩnh mà không gọi được công cụ live. | Đồng bộ hóa cả hai route, truyền Supabase URL, Anon Key, User Bearer Token và `userId` đã xác thực qua RLS. |
| **System Prompt** | `FINANCE_SYSTEM_PROMPT` trong `ai-chat.service.ts`. | Chỉ yêu cầu trả lời chung chung, thiếu hướng dẫn phân tích 3 bước và quy tắc đánh giá khả năng chi trả What-If. | Cập nhật cấu trúc hướng dẫn Grounding, phân tích 3 bước chi tiêu, bảo vệ bảo mật, định dạng Markdown rõ ràng. |
| **Phân loại câu hỏi** | `isObviouslyOffTopic()` chỉ lọc từ khóa thô sơ. | Thiếu phân nhóm ý định chuyên biệt, một số câu hỏi có từ "hôm nay", "hôm qua" bị chặn nhầm. | Xây dựng bộ phân loại `classifyFinancialQuery()` 7 nhóm ý định và tinh chỉnh biểu thức Regex tài chính. |
| **Bảo mật & Supabase** | Token JWT được verify qua `verifySupabaseAccessToken()`. | Chưa có cơ chế sandbox ngăn AI chạy câu lệnh SQL trực tiếp. | Thiết lập Backend Tool Calling cố định 8 functions, truy vấn qua Supabase Client kèm token xác thực của user. |

---

## 3. KIẾN TRÚC TOOL CALLING CÓ KIỂM SOÁT

Hệ thống triển khai 8 công cụ tài chính chuyên biệt tại `backend/src/services/financial-tools.service.ts`:

- `get_wallet_balances`: Truy xuất số dư từng ví, tổng số dư, tiền giữ chỗ mục tiêu (reserved funds), số dư khả dụng thực tế (`balance - reserved_amount`). Phân tách tiền tệ VND và USD riêng biệt.
- `get_spending_analysis`: Tổng thu nhập, tổng chi tiêu, tiết kiệm ròng, tỷ lệ tiết kiệm (%), so sánh chi tiêu với tháng trước (tăng/giảm số tiền và %), top danh mục chi nhiều nhất. Loại trừ chuyển tiền nội bộ.
- `get_budget_status`: Hạn mức danh mục, chi tiêu thực tế (tính cả chi trực tiếp từ ví), còn được chi theo hạn mức, quỹ phong bì cấp vốn còn lại, tỷ lệ sử dụng (%), ngưỡng cảnh báo (An toàn <80%, Sắp đạt >=80%, Vượt hạn mức >100%).
- `get_savings_goals`: Mục tiêu tiết kiệm, số tiền đã tích lũy, số tiền còn thiếu, tỷ lệ hoàn thành (%), ngày hết hạn (deadline).
- `get_recent_transactions`: Lịch sử giao dịch gần đây, hỗ trợ lọc theo danh mục, loại giao dịch (thu/chi/chuyển khoản).
- `evaluate_purchase_affordability`: Phân tích món đồ cần mua (tên món và giá), so sánh với số dư khả dụng của ví và hạn mức danh mục tương ứng. Trả về trạng thái `AFFORDABLE_SAFE`, `WARNING_BUDGET` hoặc `WARNING_BALANCE`.
- `get_financial_advice`: Tổng hợp toàn cảnh tài chính (ví + ngân sách + tiết kiệm + lịch sử) và đưa ra khuôn mẫu tư vấn 3 bước.
- `get_system_knowledge`: RAG tra cứu cẩm nang hệ thống, hướng dẫn thêm giao dịch, tạo ví, xuất Excel, quản lý quyền hạn.

---

## 4. XỬ LÝ CÁC TÌNH HUỐNG TRỌNG TÂM

### 4.1. "Tôi có bao nhiêu tiền?"
- **Logic xử lý:** Truy vấn toàn bộ ví thuộc quyền sở hữu của user từ bảng `wallets`.
- **Số dư đầu kỳ & Thu chi:** Bảng `wallets.balance` phản ánh số dư lũy kế chính xác. Giao dịch chuyển tiền nội bộ (`type = 'transfer'`) chỉ điều chuyển giữa các ví, không làm thay đổi tổng tài sản, không bị tính trùng vào thu hoặc chi.
- **Tiền giữ chỗ & Tiền khả dụng:** 
  $$\text{Số dư khả dụng} = \text{Tổng số dư} - \text{Tiền dự trữ cho mục tiêu tiết kiệm (Reserved)}$$
- **Phân biệt tiền ngân hàng vs ghi nhận:** Phân tách rõ ví tiền mặt (`cash`), tài khoản ngân hàng (`bank`), ví điện tử (`e-wallet`).
- **Phân tách tiền tệ:** Tuyệt đối không cộng gộp VND và USD nếu chưa có chuyển đổi tỷ giá chính thức.

### 4.2. "Tôi nên làm gì với số tiền hiện tại?"
Hệ thống cung cấp lời khuyên tài chính cá nhân hóa theo **Quy tắc 3 bước**:
1. **Bước 1 — Đảm bảo chi tiêu thiết yếu:** Rà soát hạn mức ngân sách các danh mục sinh hoạt thiết yếu (Ăn uống, Nhà ở, Hóa đơn) đến hết tháng để không bị thâm hụt.
2. **Bước 2 — Đóng góp mục tiêu tiết kiệm:** Ưu tiên trích phần tiết kiệm vào các mục tiêu có hạn chót gần nhất (ví dụ: mục tiêu *Mua Laptop M3*).
3. **Bước 3 — Sử dụng tiền nhàn rỗi:** Phần thặng dư khả dụng còn lại mới được xem xét cho chi tiêu tùy ý, giải trí hoặc quỹ khẩn cấp.

### 4.3. Hội thoại nhiều lượt & Đánh giá What-If
- Chatbot ghi nhớ ngữ cảnh lịch sử hội thoại gần nhất.
- Khi người dùng hỏi *"Có nên mua điện thoại 15 triệu không?"*, công cụ `evaluate_purchase_affordability` trích xuất `15.000.000 VND`, đối chiếu với số dư khả dụng (14.500.000 VND) và đưa ra cảnh báo thiếu 500.000 VND.
- Khi người dùng hỏi tiếp *"Vậy tôi có nên mua không?"*, mô hình giữ nguyên chủ đề chiếc điện thoại 15 triệu từ lịch sử để tư vấn mà không yêu cầu nhập lại.

---

## 5. BẢO MẬT VÀ PHÂN QUYỀN (RLS & ZERO SQL INJECTION)

1. **Không thực thi SQL tùy ý:** AI không nhận prompt cho phép sinh mã SQL và backend không cung cấp bất kỳ API thực thi raw SQL nào cho AI.
2. **Xác thực danh tính qua JWT:** Token của người dùng được kiểm tra qua `verifySupabaseAccessToken()`. Mọi lệnh gọi Supabase đều mang header `Authorization: Bearer <token>`, tự động kích hoạt Row-Level Security ở tầng cơ sở dữ liệu.
3. **Cách ly tuyệt đối:** User A chỉ truy xuất được dữ liệu của User A. Truy vấn dữ liệu của User B sẽ bị RLS chặn và trả về kết quả rỗng.
4. **Không để lộ khóa bảo mật:** `SUPABASE_SERVICE_ROLE_KEY` không bao giờ được gửi vào context prompt của AI. Prompt chứa quy tắc bảo mật cấm AI tiết lộ cấu hình hệ thống.

---

## 6. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG

### 6.1. Bộ kiểm thử chuyên biệt 33 tình huống (`tests/smart-financial-assistant-30.test.mjs`)
Tất cả 33 kịch bản đã được chạy và vượt qua **100% (33/33 PASS)** trong thời gian 232ms.

### 6.2. Kiểm thử hồi quy toàn bộ hệ thống (`npm run test:unit`)
- **Tổng số test cases:** 181
- **Pass:** 181 / 181 (100%)
- **Fail:** 0
- **Thời gian chạy:** 2.35 giây

### 6.3. Kiểm thử TypeScript & ESLint
- `npx tsc --noEmit`: **0 lỗi** (Clean strict mode)
- `node scripts/run-lint.mjs`: **0 lỗi, 0 cảnh báo**
- `npm run build:worker`: **Thành công** (Thời gian build 1.18s)

---

## 7. CÁC TỆP TIN THAY ĐỔI VÀ TẠO MỚI

1. `backend/src/services/financial-tools.service.ts` *(Tạo mới)*:
   - Triển khai 8 công cụ tài chính xác định với TypeScript strict types.
   - Hàm `classifyFinancialQuery()` và `parsePurchaseQuery()`.
   - Hàm `executeFinancialTool()` bảo vệ quyền truy cập theo RLS.
2. `backend/src/services/ollama-client.ts`:
   - Thêm định nghĩa interfaces `OllamaToolDefinition`, `OllamaToolCall`, `OllamaChatMessage`.
   - Mở rộng options hỗ trợ `tools` gửi sang Ollama `/api/chat`.
   - Xử lý phản hồi `tool_calls` từ mô hình.
3. `backend/src/services/ai-chat.service.ts`:
   - Cập nhật `FINANCE_SYSTEM_PROMPT` với các quy tắc tài chính nghiêm ngặt.
   - Triển khai cơ chế vòng lặp Tool Execution & Synthesis Loop.
   - Tinh chỉnh `FINANCIAL_INTENT_PATTERNS` tránh lọc nhầm các câu hỏi có từ ngữ thời gian.
4. `app/api/chat/route.ts`:
   - Bổ sung `toolContext` truyền token và `userId` của user đã xác thực vào `processChat`.
5. `worker/index.ts`:
   - Tích hợp `buildServerFinancialContext` và `toolContext` cho Cloudflare Worker runtime.
6. `tests/smart-financial-assistant-30.test.mjs` *(Tạo mới)*:
   - Bộ 33 kịch bản kiểm thử độc lập cho trợ lý tài chính thông minh.
7. `tests/ai-evaluation/auth-helper.mjs` *(Tạo mới)*:
   - Cung cấp JWT token động cho test harness để chống hết hạn token.

---

## 8. HƯỚNG DẪN KIỂM TRA TRỰC TIẾP TRÊN GIAO DIỆN (UI/UX)

1. **Khởi chạy hệ thống:**
   - Đảm bảo Ollama đang chạy: `ollama run qwen2.5-coder:7b`
   - Đảm bảo Web server đang chạy: `http://localhost:5173`
2. **Đăng nhập:**
   - Truy cập `http://localhost:5173` và đăng nhập tài khoản có dữ liệu (ví dụ: `test_copilot@sochitieu.com` / `TestPassword123!`).
3. **Mở Chatbot AI:**
   - Bấm vào biểu tượng bong bóng chat ở góc dưới bên phải màn hình để mở **Financial Copilot**.
4. **Thực hiện các câu hỏi thử nghiệm:**
   - *"Tôi có bao nhiêu tiền?"* 👉 AI đọc chính xác tổng số dư, tiền giữ chỗ, số dư khả dụng và chi tiết từng ví.
   - *"Tháng này tôi đã chi tiêu bao nhiêu?"* 👉 AI đọc chính xác 4.850.000đ, chỉ ra danh mục Ăn uống chiếm 2.650.000đ (54.6%) và so sánh giảm 650.000đ so với tháng trước.
   - *"Tôi có nên mua điện thoại 15 triệu không?"* 👉 AI so sánh giá 15.000.000đ với số dư khả dụng 14.500.000đ, cảnh báo thiếu 500.000đ.
   - *"Vậy tôi có nên mua không?"* 👉 AI duy trì ngữ cảnh chiếc điện thoại 15 triệu từ câu hỏi trước.
   - *"Tôi nên làm gì với số tiền hiện tại?"* 👉 AI cung cấp lời khuyên 3 bước có cấu trúc.
