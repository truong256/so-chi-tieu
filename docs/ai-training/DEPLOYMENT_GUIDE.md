# 🚀 Hướng dẫn Vận hành & Triển khai AI Chatbot — Sổ Chi Tiêu (Deployment Guide)

Tài liệu hướng dẫn chi tiết cách cấu hình, vận hành, kiểm thử và chạy lại quy trình huấn luyện cho Trợ lý AI (Financial Copilot).

---

## 1. Yêu cầu Tiên quyết (Prerequisites)

- **Node.js:** `>= 22.13.0`
- **Python:** `3.11.x`
- **Ollama:** Đã cài đặt trên máy chủ (Port mặc định: `11434`).
- **Mô hình khuyến nghị:** `qwen2.5-coder:7b` (đã có sẵn trong Ollama) hoặc `llama3.2:3b`.
- **Database:** Supabase PostgreSQL với các migrations từ `000` đến `011`.

---

## 2. Cấu hình Biến Môi trường (.env.local)

Đảm bảo các biến môi trường sau được thiết lập đầy đủ trong `.env.local`:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://xqclhgyrkwaipwokooxe.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_7A3Jnp28OveJw8Tvg9cY6A_tQ67V5oh

# Ollama Server URL (Local / Self-Hosted)
OLLAMA_BASE_URL=http://127.0.0.1:11434

# Internal Microservice URL (FastAPI)
AI_SERVICE_URL=http://127.0.0.1:8000
```

---

## 3. Khởi động các Dịch vụ

### Bước 1: Khởi động Ollama Server
Mở terminal và chạy lệnh:
```powershell
ollama serve
```
Kiểm tra danh sách mô hình đã tải:
```powershell
ollama list
```
*(Nếu cần tải thêm model LLaMA: `ollama pull llama3.2:3b`)*

### Bước 2: Khởi động Ứng dụng Web (Frontend & Next.js API Routes)
```powershell
npm run dev
```
Truy cập ứng dụng tại: `http://localhost:5173`.

### Bước 3: (Tùy chọn) Khởi động AI FastAPI Container Microservice
```powershell
python -m uvicorn ai_service.app:app --host 127.0.0.1 --port 8000
```

---

## 4. Cách Chạy lại Toàn bộ Quy trình AI Training

### 1. Sinh lại Bộ Dữ liệu Huấn luyện (Dataset Generation)
```powershell
python ai_training/scripts/generate_dataset.py
```
- Tự động sinh ra 360 mẫu hội thoại chuẩn hóa và phân tách vào `train.jsonl`, `val.jsonl`, `test.jsonl`.

### 2. Kiểm thử Độc lập Hệ thống RAG (RAG Unit Tests)
```powershell
node --experimental-strip-types --test tests/system-rag.test.mjs
```
- Chạy 8 ca kiểm thử tự động kiểm tra khả năng tra cứu, chuẩn hóa tiếng Việt không dấu và phân quyền dữ liệu.

### 3. Chạy Suite Đánh giá Chất lượng (Evaluation Suite)
```powershell
python ai_training/scripts/evaluate.py
```
- Tự động kiểm tra 10 câu hỏi nghiệp vụ bắt buộc và 3 tình huống tấn công/lỗi, xuất kết quả ra `docs/ai-training/evaluation_results.json`.

### 4. Chạy Thử nghiệm Huấn luyện LoRA (Khi có GPU đủ điều kiện)
```powershell
.\training_env\Scripts\python.exe -u ai_training/scripts/train_lora.py --base_model Qwen/Qwen2.5-0.5B-Instruct --epochs 2
```

---

## 5. Cơ chế Rollback & Khôi phục An toàn

1. **Khôi phục Base Prompt gốc:** Nếu cần tắt tính năng RAG, chỉ cần bỏ dòng ghép `ragContext` trong `backend/src/services/ai-chat.service.ts`.
2. **Khôi phục Model AI:** Danh sách mô hình fallback được cấu hình tại `backend/src/services/ollama-models.ts`. Nếu một mô hình gặp sự cố, hệ thống tự động thử lần lượt các model dự phòng tiếp theo.
3. **Bảo toàn dữ liệu:** Dữ liệu tài chính người dùng được lưu trữ an toàn độc lập trên Supabase PostgreSQL có RLS, không bị ảnh hưởng bởi việc thay đổi hoặc cấu hình lại các mô hình AI.
