# Model Advisor — Personal Financial Advisor AI

Hệ thống tư vấn tài chính cá nhân độc lập dành cho ứng dụng **Sổ Chi Tiêu**, tự động phân tích sức khỏe tài chính, chấm điểm rủi ro, phát hiện cảnh báo ngân sách và đề xuất kế hoạch hành động cụ thể bằng tiếng Việt.

---

## 1. Cấu Trúc Thư Mục

```text
model_advisor/
├── data/
│   ├── raw/
│   │   └── financial_profiles_raw.json   # 2,000 hồ sơ tài chính gốc
│   ├── train.json                        # 1,400 mẫu huấn luyện (70%)
│   ├── val.json                          # 300 mẫu validation (15%)
│   └── test.json                         # 300 mẫu test độc lập (15%)
├── models/
│   ├── advisor_model.pkl                 # Model weights & scaler parameters
│   └── metadata.json                     # Thông tin kiến trúc, features, hyperparams
├── metrics/
│   ├── baseline_metrics.json             # Kết quả đánh giá Rule-based Baseline
│   ├── metrics.json                      # Kết quả training & validation
│   └── evaluation_report.json            # Báo cáo so sánh Model vs Baseline trên test set
├── scripts/
│   ├── generate_dataset.py               # Sinh dataset giả lập 4 nhóm tài chính
│   ├── validate_dataset.py               # Kiểm tra schema, ràng buộc và rò rỉ dữ liệu
│   ├── baseline.py                       # Heuristic Rule-Based Benchmark
│   ├── train.py                          # Feature extraction & huấn luyện mô hình
│   ├── evaluate.py                       # Đánh giá độc lập trên tập test
│   └── inference.py                      # Standalone CLI & programmatic inference
├── tests/
│   ├── sample.json                       # Hồ sơ mẫu tiêu chuẩn (HEALTHY)
│   ├── sample_danger.json                # Hồ sơ mẫu thâm hụt rủi ro cao (CRITICAL)
│   ├── sample_excellent.json             # Hồ sơ mẫu tích lũy xuất sắc (EXCELLENT)
│   └── test_advisor.py                   # Automated Pytest suite (7/7 tests passed)
├── requirements.txt                      # Danh sách thư viện phụ thuộc
├── README.md                             # Hướng dẫn sử dụng
└── REPORT.md                             # Báo cáo kỹ thuật chi tiết & Model Status
```

---

## 2. Hướng Dẫn Chạy Độc Lập (Standalone CLI)

Mô hình hoạt động **100% độc lập**, không phụ thuộc Next.js, Supabase, hoặc bất kỳ web framework nào.

### A. Chạy Inference với file JSON mẫu

```bash
python model_advisor/scripts/inference.py --input model_advisor/tests/sample.json
```

**Kết quả trả về chuẩn JSON:**

```json
{
  "summary": "Đánh giá tài chính LÀNH MẠNH & ỔN ĐỊNH (Điểm rủi ro: 0.36): Thu nhập 25,000,000đ, chi tiêu 18,500,000đ. Bạn duy trì tỷ lệ tích lũy tốt đạt 26.0% (thặng dư 6,500,000đ). Quỹ dự phòng hiện đạt 1.7 tháng, đảm bảo sự an tâm trước các biến động ngắn hạn.",
  "warnings": [
    "Cảnh báo đệm tài chính mỏng: Quỹ dự phòng đạt 1.7 tháng (thấp hơn khuyến nghị 3-6 tháng).",
    "Vượt hạn mức ngân sách: Danh mục 'Ăn ngoài & Cafe' đã chi vượt định mức 650,000đ (+32.5%).",
    "Vượt hạn mức ngân sách: Danh mục 'Ăn uống gia đình' đã chi vượt định mức 200,000đ (+4.0%).",
    "Vượt hạn mức ngân sách: Danh mục 'Mua sắm & Quần áo' đã chi vượt định mức 200,000đ (+20.0%)."
  ],
  "suggestions": [
    "Cắt giảm ngay tối thiểu 650,000đ tại danh mục 'Ăn ngoài & Cafe' để đưa chi tiêu về đúng ngân sách ban đầu.",
    "Ưu tiên xây dựng Quỹ dự phòng khẩn cấp đạt mốc 3 tháng (55,500,000đ), còn thiếu khoảng 24,000,000đ.",
    "Thiết lập trích xuất tự động 4,000,000đ vào mục tiêu 'Quỹ khẩn cấp 6 tháng' ngay trong ngày có lương để đảm bảo kỷ luật tài chính.",
    "Phân bổ phần thặng dư nhàn rỗi khoảng 4,550,000đ vào các kênh sinh lời ổn định (quỹ mở trái phiếu, chứng chỉ tiền gửi hoặc tích lũy linh hoạt)."
  ],
  "confidence": 0.98
}
```

### B. Chạy Inference với các hồ sơ khác

```bash
# Thử nghiệm hồ sơ thâm hụt / nguy cấp
python model_advisor/scripts/inference.py --input model_advisor/tests/sample_danger.json

# Thử nghiệm hồ sơ tích lũy xuất sắc
python model_advisor/scripts/inference.py --input model_advisor/tests/sample_excellent.json
```

### C. Sử dụng trong code Python (Module Import)

```python
from model_advisor.scripts.inference import AdvisorInferenceEngine

engine = AdvisorInferenceEngine()
profile = {
    "income": 20000000,
    "expense": 14000000,
    "categories": [...],
    "wallets": [...],
    "savings_goals": [...]
}
advice = engine.predict(profile)
print(advice["summary"])
```

---

## 3. Quy Trình Huấn Luyện & Đánh Giá

### 1. Sinh & thẩm định dữ liệu
```bash
python model_advisor/scripts/generate_dataset.py
python model_advisor/scripts/validate_dataset.py
```

### 2. Chạy baseline benchmark
```bash
python model_advisor/scripts/baseline.py
```

### 3. Huấn luyện mô hình
```bash
python model_advisor/scripts/train.py
```

### 4. Đánh giá độc lập trên tập test
```bash
python model_advisor/scripts/evaluate.py
```

### 5. Chạy automated test suite
```bash
pytest model_advisor/tests/test_advisor.py -v
```

---

## 4. Trạng Thái Mô Hình

- **Health Grade Accuracy:** `100.00%` trên test set (300 mẫu)
- **Macro F1 Score:** `1.0000`
- **Risk Score MAE:** `0.0654`
- **Thời gian xử lý trung bình:** `0.045 ms/sample` (P99: `0.123 ms`)
- **Trạng thái:** `MODEL STATUS = ACCEPT`
