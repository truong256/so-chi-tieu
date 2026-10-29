#!/usr/bin/env node
/**
 * scripts/scan-receipt.mjs
 * =======================
 * CLI Tool to scan and parse receipts using the local Vision AI model (LLaVA / Moondream).
 *
 * Usage:
 *   node scripts/scan-receipt.mjs [path/to/receipt.jpg]
 *   npm run scan:receipt -- [path/to/receipt.jpg]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectVisionModel } from "../backend/src/services/ollama-client.ts";
import { parseReceiptWithAI } from "../backend/src/services/receipt-parser.service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("\n=======================================================");
  console.log("  AI RECEIPT SCANNER (MÔ HÌNH THỊ GIÁC QUÉT HÓA ĐƠN)");
  console.log("=======================================================\n");

  const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

  // 1. Check vision model
  process.stdout.write("1. Đang kiểm tra mô hình thị giác trong Ollama... ");
  const { model, error: modelErr } = await selectVisionModel(baseUrl);
  if (!model || modelErr) {
    console.log("❌ LỖI");
    console.error(modelErr?.messageVi || "Không tìm thấy mô hình thị giác khả dụng.");
    console.error("Vui lòng đảm bảo Ollama đang chạy và đã pull model: ollama pull llava");
    process.exit(1);
  }
  console.log(`✔ Đã kết nối model: [${model}]`);

  // 2. Resolve image path
  const args = process.argv.slice(2);
  let imagePath = args[0];

  if (!imagePath) {
    // Look for default sample images
    const defaultCandidates = [
      path.join(__dirname, "../media_03/image1.png"),
      path.join(__dirname, "../media_03/image2.png"),
      path.join(__dirname, "../dist/client/finance-login-hero-v2.webp"),
    ];
    for (const cand of defaultCandidates) {
      if (fs.existsSync(cand)) {
        imagePath = cand;
        break;
      }
    }
  }

  if (!imagePath || !fs.existsSync(imagePath)) {
    console.error(`❌ Không tìm thấy tệp ảnh: ${imagePath || "chưa truyền đường dẫn"}`);
    console.log("Cách dùng: node scripts/scan-receipt.mjs <đường_dẫn_tệp_ảnh>");
    process.exit(1);
  }

  console.log(`2. Tệp ảnh xử lý: ${imagePath}`);
  const fileBytes = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  const mimeType = mimeMap[ext] || "image/jpeg";
  const base64Data = fileBytes.toString("base64");
  console.log(`   Dung lượng: ${(fileBytes.length / 1024).toFixed(1)} KB | Định dạng: ${mimeType}`);

  // 3. Categories and Wallets for contextual classification
  const defaultCategories = [
    "Ăn uống",
    "Mua sắm",
    "Di chuyển",
    "Hóa đơn & Tiện ích",
    "Giải trí",
    "Sức khỏe",
    "Giáo dục",
    "Khác"
  ];
  const defaultWallets = ["Tiền mặt", "Ví MoMo", "Tài khoản Ngân hàng", "Thẻ tín dụng"];

  // 4. Run vision OCR
  console.log(`3. Đang gửi ảnh tới mô hình thị giác AI [${model}] để trích xuất dữ liệu...`);
  const startTime = Date.now();

  const parseResult = await parseReceiptWithAI({
    ollamaBaseUrl: baseUrl,
    base64Data,
    mimeType,
    categoriesList: defaultCategories,
    walletsList: defaultWallets,
    totalTimeoutMs: 120000,
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✔ Hoàn tất phân tích sau ${durationSec}s!\n`);

  if (!parseResult.success || !parseResult.data) {
    console.error("❌ Không thể trích xuất hóa đơn:", parseResult.error);
    process.exit(1);
  }

  const d = parseResult.data;

  // 5. Display formatted results
  console.log("-------------------------------------------------------");
  console.log("  KẾT QUẢ BÓC TÁCH HÓA ĐƠN TỰ ĐỘNG");
  console.log("-------------------------------------------------------");
  console.log(`• Là hóa đơn hợp lệ : ${d.is_receipt ? "Có (True)" : "Không (Ảnh khác)"}`);
  console.log(`• Loại chứng từ     : ${d.document_type || "N/A"}`);
  console.log(`• Đơn vị / Cửa hàng : ${d.merchant || "(Không xác định)"}`);
  if (d.merchant_address) console.log(`• Địa chỉ           : ${d.merchant_address}`);
  console.log(`• Ngày thanh toán   : ${d.date || "(Không có ngày)"}`);
  console.log(`• Giờ giao dịch     : ${d.time || "(Không có giờ)"}`);
  console.log(`• Danh mục gợi ý    : ${d.category || "(Chưa phân loại)"}`);
  console.log(`• Hình thức TT      : ${d.payment_method || "(Không rõ)"}`);
  console.log(`• Loại giao dịch    : ${d.transaction_type === "expense" ? "Chi tiêu" : "Thu nhập"}`);
  console.log(`• TỔNG TIỀN         : ${d.total != null ? d.total.toLocaleString("vi-VN") + " " + (d.currency || "VND") : "(Không thấy tổng tiền)"}`);
  
  if (d.subtotal != null) console.log(`  - Tạm tính        : ${d.subtotal.toLocaleString("vi-VN")} ${d.currency || "VND"}`);
  if (d.discount != null && d.discount > 0) console.log(`  - Giảm giá        : -${d.discount.toLocaleString("vi-VN")} ${d.currency || "VND"}`);
  if (d.tax != null && d.tax > 0) console.log(`  - Thuế VAT        : +${d.tax.toLocaleString("vi-VN")} ${d.currency || "VND"}`);

  if (Array.isArray(d.items) && d.items.length > 0) {
    console.log("\n• Danh sách món / sản phẩm đã mua:");
    d.items.forEach((item, idx) => {
      const q = item.quantity != null ? ` x${item.quantity}` : "";
      const price = item.total_price != null ? ` = ${item.total_price.toLocaleString("vi-VN")} VND` : "";
      console.log(`   ${idx + 1}. ${item.name}${q}${price}`);
    });
  }

  if (d.warnings && d.warnings.length > 0) {
    console.log("\n⚠️ Lưu ý / Cảnh báo:");
    d.warnings.forEach(w => console.log(`   - ${w}`));
  }

  console.log("-------------------------------------------------------\n");
}

main().catch(err => {
  console.error("Lỗi khi chạy quét hóa đơn:", err);
  process.exit(1);
});
