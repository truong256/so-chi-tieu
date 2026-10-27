# 🤖 Quy trình Huấn luyện & Tích hợp AI Chatbot — Sổ Chi Tiêu

Tài liệu tổng quan về quy trình nghiên cứu, chuẩn bị dữ liệu, đánh giá phần cứng, xây dựng RAG và tích hợp Trợ lý AI (Financial Copilot) chuyên biệt cho dự án **Sổ Chi Tiêu**.

---

## 1. Mục tiêu & Năng lực của AI Chatbot

Chatbot được thiết kế với 2 năng lực cốt lõi:
1. **Financial AI Assistant (Tư vấn Tài chính Cá nhân):**
   - Phân tích thu nhập, chi tiêu, ngân sách, số dư và tỷ lệ tiết kiệm.
   - So sánh dữ liệu giữa các khoảng thời gian (tháng này vs tháng trước).
   - Dự báo xu hướng và phân tích kịch bản What-If ("Nếu mua X giá Y thì ngân sách còn bao nhiêu?").
   - Cô lập tiền tệ tuyệt đối: Không cộng gộp chéo VND và USD hoặc ngoại tệ khác.
   - Toàn bộ con số tài chính được tính toán xác thực từ máy chủ dưới cơ chế Row-Level Security (RLS) của Supabase.
2. **System Knowledge Assistant (Cố vấn Kiến trúc & Hướng dẫn Sử dụng Hệ thống):**
   - Nắm rõ toàn bộ kiến trúc 5 tầng, tính năng Quản lý ví, Chuyển tiền, Ngân sách, Mục tiêu tiết kiệm, Giao dịch định kỳ, AI Quét hóa đơn (OCR), Xuất báo cáo Excel và Phân quyền Admin (RBAC).
   - Giải thích nguyên nhân các trạng thái hệ thống (ví dụ: tại sao số dư khả dụng thấp hơn số dư ví do Tiền dự trữ).
   - **Nguyên tắc an toàn (Guardrail):** Là trợ lý đọc (Read-only advisory); **TUYỆT ĐỐI KHÔNG** tự ý tạo, sửa, xóa giao dịch qua lời nói; hướng dẫn người dùng thao tác qua giao diện web.

---

## 2. Bảng Trạng thái Triển khai (Implementation Status)

Tuân thủ nghiêm ngặt nguyên tắc trung thực kỹ thuật và phân loại rõ ràng:

| Giai đoạn | Hạng mục | Trạng thái | Ghi chú & Kết quả |
|---|---|---|---|
| **Giai đoạn 1** | Kiểm tra dự án, Git & Phần cứng | `COMPLETED` | Nhánh `feature/financial-chatbot-training`; CPU i7-10750H, 16GB RAM, RTX 2060 6GB VRAM, CUDA 12.9 |
| **Giai đoạn 2** | Nghiên cứu Model (Qwen3.5 4B & Qwen2.5) | `COMPLETED` | Qwen3.5-4B yêu cầu tối thiểu 8–12 GB VRAM; xác nhận vượt quá 6GB VRAM của RTX 2060 |
| **Giai đoạn 3** | Xây dựng Bộ Dữ liệu Huấn luyện | `COMPLETED` | 360 mẫu JSONL chuẩn ChatML (Train: 251, Val: 55, Test: 54) không rò rỉ |
| **Giai đoạn 4** | Xây dựng Hệ thống System RAG | `COMPLETED` | 13 knowledge chunks, hybrid search, diacritics normalizer, tích hợp trực tiếp vào `ai-chat.service.ts` |
| **Giai đoạn 5** | Huấn luyện LoRA / QLoRA | `BLOCKED` | **BLOCKED do giới hạn VRAM phần cứng** (6GB < 8–12GB). Đã hoàn thiện script `train_lora.py` và cơ chế memory guard |
| **Giai đoạn 6** | Đánh giá & Đo lường (Evaluation Suite) | `COMPLETED` | Đạt **100% Accuracy (13/13)** trên bộ test bắt buộc và edge cases; Refusal Guardrail đạt **100%** |
| **Giai đoạn 7** | Tích hợp Runtime & Ollama | `COMPLETED` | Ollama runtime `qwen2.5-coder:7b` + RAG Grounding + Server Financial Context |
| **Giai đoạn 8** | Kiểm thử End-to-End (E2E) | `COMPLETED` | Kiểm thử thành công 10 câu hỏi nghiệp vụ và 3 câu hỏi tấn công/lỗi database |

---

## 3. Cấu trúc Thư mục AI Training

```text
so-chi-tieu/
├── ai_training/
│   ├── dataset/
│   │   ├── dataset_full.jsonl       # Toàn bộ 360 mẫu hội thoại tiếng Việt đã kiểm chứng
│   │   ├── train.jsonl              # 251 mẫu tập huấn luyện (70%)
│   │   ├── val.jsonl                # 55 mẫu tập validation (15%)
│   │   └── test.jsonl               # 54 mẫu tập kiểm thử độc lập (15%)
│   └── scripts/
│       ├── generate_dataset.py      # Sinh và phân tách dataset không trùng lặp
│       ├── check_cuda.py            # Kiểm tra trạng thái PyTorch CUDA và GPU
│       ├── train_lora.py            # Pipeline Supervised Fine-Tuning LoRA có Memory Guard
│       └── evaluate.py              # Suite đánh giá 13 câu hỏi nghiệp vụ và bảo mật
│
├── backend/src/services/
│   ├── system-rag.service.ts        # RAG Engine nạp trực tiếp tri thức hệ thống vào Chatbot
│   ├── ai-chat.service.ts           # Business logic điều phối Prompt, RAG và Financial Context
│   └── financial-context.service.ts # Tính toán dữ liệu tài chính máy chủ với Supabase RLS
│
└── docs/ai-training/
    ├── README.md                    # Tài liệu này
    ├── DATASET_REPORT.md            # Báo cáo chi tiết về bộ dữ liệu huấn luyện
    ├── TRAINING_REPORT.md           # Báo cáo đánh giá phần cứng & log thực thi SFT
    ├── EVALUATION_REPORT.md         # Báo cáo đo lường chất lượng trước/sau tích hợp RAG
    └── DEPLOYMENT_GUIDE.md          # Hướng dẫn vận hành và chạy lại quy trình
```

---

## 4. Tài liệu Chi tiết

- [Báo cáo Bộ Dữ liệu (DATASET_REPORT.md)](./DATASET_REPORT.md)
- [Báo cáo Huấn luyện & Phần cứng (TRAINING_REPORT.md)](./TRAINING_REPORT.md)
- [Báo cáo Đánh giá Chất lượng (EVALUATION_REPORT.md)](./EVALUATION_REPORT.md)
- [Hướng dẫn Vận hành & Triển khai (DEPLOYMENT_GUIDE.md)](./DEPLOYMENT_GUIDE.md)
