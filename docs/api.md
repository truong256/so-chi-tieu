# Tài liệu API & Backend Services — Sổ Chi Tiêu

Tài liệu mô tả các API endpoints và dịch vụ xử lý backend của hệ thống.

---

## 1. Danh sách Endpoints

| Endpoint | Method | Mô tả | Authentication | Backend Service |
|---|---|---|---|---|
| `/api/chat` | `POST` | Financial Copilot: Trò chuyện và tư vấn tài chính | Bearer Token (Supabase) | `backend/src/services/ai-chat.service.ts` |
| `/api/ai/parse-transaction` | `POST` | NLP Transaction Parser: Nhận diện giao dịch từ văn bản tự nhiên | Bearer Token (Supabase) | `backend/src/services/ai-parser.service.ts` |
| `/api/receipt/parse` | `POST` | Receipt OCR: Phân tích hóa đơn / biên lai từ hình ảnh | Bearer Token (Supabase) | `backend/src/services/receipt-parser.service.ts` |
| `/api/runtime-config` | `GET` | Cung cấp cấu hình Supabase URL/Key an toàn cho client | Public | Direct Handler |
| `/api/client-error` | `POST` | Thu thập log lỗi client-side để giám sát | Public | Direct Handler |

---

## 2. Chi tiết Endpoints

### 1. AI Chatbot (`POST /api/chat`)
- **Headers**: `Authorization: Bearer <supabase_access_token>`, `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "message": "Tháng này tôi tiêu hết bao nhiêu rồi?",
    "history": [],
    "financialContext": {
      "totalBalance": 15000000,
      "monthlyIncome": 25000000,
      "monthlyExpense": 10000000,
      "wallets": [],
      "budgets": [],
      "savingsGoals": [],
      "transactions": []
    },
    "currentPage": "overview",
    "clientTime": "2026-08-17T21:00:00.000Z"
  }
  ```
- **Response**:
  ```json
  {
    "reply": "Tháng này bạn đã chi tiêu **10.000.000đ**..."
  }
  ```

---

### 2. AI Parse Transaction (`POST /api/ai/parse-transaction`)
- **Headers**: `Authorization: Bearer <supabase_access_token>`, `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "text": "Ăn trưa 50k bằng tiền mặt",
    "client_date": "2026-08-17",
    "client_time": "12:30",
    "timezone": "Asia/Ho_Chi_Minh"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "transaction_type": "expense",
      "amount": 50000,
      "currency": "VND",
      "category_id": "...",
      "category_name": "Ăn uống",
      "wallet_id": "...",
      "wallet_name": "Tiền mặt",
      "description": "Ăn trưa",
      "date": "2026-08-17",
      "time": "12:30",
      "confidence_notes": []
    }
  }
  ```

---

### 3. AI Receipt Parse (`POST /api/receipt/parse`)
- **Headers**: `Authorization: Bearer <supabase_access_token>`
- **Content-Type**: `multipart/form-data` hoặc `application/json` (hỗ trợ Base64 / Data URL)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "document_type": "receipt",
      "is_receipt": true,
      "merchant": "Circle K",
      "merchant_address": "...",
      "transaction_type": "expense",
      "date": "2026-08-17",
      "time": "18:45",
      "currency": "VND",
      "total": 125000,
      "subtotal": 125000,
      "discount": null,
      "tax": null,
      "payment_method": "MoMo",
      "category": "Mua sắm",
      "description": "Mua hàng tại Circle K",
      "items": [
        { "name": "Bánh mì", "quantity": 1, "unit_price": 25000, "total_price": 25000 }
      ],
      "warnings": []
    }
  }
  ```
