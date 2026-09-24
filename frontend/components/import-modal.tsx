"use client";

import { useState, useRef } from "react";
import type { Category, Transaction, Wallet } from "../types/finance.types";
import {
  autoDetectColumnMapping,
  parseCsvText,
  parseXlsxBuffer,
  prepareImportPreview,
  type ColumnMapping,
  type ImportedRowPreview,
} from "../services/excel-csv-import.service";

interface ImportModalProps {
  categories: Category[];
  wallets: Wallet[];
  existingTransactions: Transaction[];
  onClose: () => void;
  onSuccess: (importedCount: number) => void;
  showNotice: (msg: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
}

export default function ImportModal({
  categories,
  wallets,
  existingTransactions,
  onClose,
  onSuccess,
  showNotice,
  supabase,
  userId,
}: ImportModalProps) {
  const [step, setStep] = useState<"upload" | "mapping" | "preview">("upload");
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [previews, setPreviews] = useState<ImportedRowPreview[]>([]);
  const [filterTab, setFilterTab] = useState<"all" | "valid" | "duplicate" | "invalid">("all");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    try {
      let parsed: string[][] = [];
      if (file.name.endsWith(".csv")) {
        const text = await file.text();
        parsed = parseCsvText(text);
      } else if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        const arrayBuffer = await file.arrayBuffer();
        parsed = parseXlsxBuffer(new Uint8Array(arrayBuffer));
      } else {
        showNotice("Định dạng tệp không được hỗ trợ. Vui lòng chọn tệp .csv hoặc .xlsx.");
        return;
      }

      if (parsed.length <= 1) {
        showNotice("Tệp không có dữ liệu giao dịch.");
        return;
      }

      setRawRows(parsed);
      const detected = autoDetectColumnMapping(parsed[0]);
      setMapping(detected);
      setStep("mapping");
    } catch (err) {
      console.error("Import file parse error:", err);
      showNotice(err instanceof Error ? err.message : "Không thể đọc tệp này.");
    }
  };

  const handleProceedToPreview = () => {
    if (!mapping.amountColumn || !mapping.titleColumn) {
      showNotice("Vui lòng chọn cột Tiêu đề và Số tiền.");
      return;
    }

    const previewList = prepareImportPreview({
      rows: rawRows,
      mapping,
      categories,
      wallets,
      existingTransactions,
      defaultWalletId: wallets[0]?.id,
    });

    setPreviews(previewList);
    setStep("preview");
  };

  const handleExecuteImport = async () => {
    const rowsToImport = previews.filter((p) => {
      if (p.status === "invalid") return false;
      if (p.status === "duplicate" && skipDuplicates) return false;
      return true;
    });

    if (rowsToImport.length === 0) {
      showNotice("Không có giao dịch hợp lệ nào để nhập.");
      return;
    }

    setImporting(true);
    setProgress(0);

    try {
      const batchSize = 50;
      let inserted = 0;

      for (let i = 0; i < rowsToImport.length; i += batchSize) {
        const chunk = rowsToImport.slice(i, i + batchSize);
        const payload = chunk.map((r) => ({
          user_id: userId,
          title: r.title,
          amount: r.amount,
          type: r.type,
          category: r.categoryName || "Khác",
          category_id: r.categoryId || null,
          wallet_id: r.walletId || wallets[0]?.id || null,
          occurred_at: r.occurredAt,
          note: r.note || "",
          payment_source_type: "wallet",
        }));

        const { error } = await supabase.from("transactions").insert(payload);
        if (error) throw error;

        inserted += chunk.length;
        setProgress(Math.round((inserted / rowsToImport.length) * 100));
      }

      showNotice(`Đã nhập thành công ${inserted} giao dịch.`);
      onSuccess(inserted);
      onClose();
    } catch (err) {
      console.error("Import execute error:", err);
      showNotice(err instanceof Error ? err.message : "Có lỗi xảy ra khi lưu giao dịch.");
    } finally {
      setImporting(false);
    }
  };

  const headers = rawRows[0] || [];
  const validCount = previews.filter((p) => p.status === "valid").length;
  const duplicateCount = previews.filter((p) => p.status === "duplicate").length;
  const invalidCount = previews.filter((p) => p.status === "invalid").length;

  const displayedPreviews = previews.filter((p) => {
    if (filterTab === "valid") return p.status === "valid";
    if (filterTab === "duplicate") return p.status === "duplicate";
    if (filterTab === "invalid") return p.status === "invalid";
    return true;
  });

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true">
      <button className="modal-backdrop" onClick={onClose} aria-label="Đóng" />
      <div className="import-modal-card">
        <div className="modal-head">
          <div>
            <p className="eyebrow">DỮ LIỆU NGOẠI TUYẾN</p>
            <h2>Nhập giao dịch từ Excel / CSV</h2>
          </div>
          <button type="button" className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {step === "upload" && (
          <div className="import-step-body">
            <div
              className="dropzone-box"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  const input = fileInputRef.current;
                  if (input) {
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    input.files = dataTransfer.files;
                    handleFileChange({ target: input } as React.ChangeEvent<HTMLInputElement>);
                  }
                }
              }}
            >
              <span className="dropzone-icon">📥</span>
              <p className="dropzone-title">Kéo thả tệp hoặc bấm vào đây để chọn</p>
              <p className="dropzone-sub">Hỗ trợ các định dạng .xlsx, .xls và .csv (tối đa 10 MB)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
            </div>
            <div className="import-sample-tips">
              <p>💡 <b>Mẹo cấu trúc cột:</b></p>
              <ul>
                <li>Các cột phổ biến: <i>Ngày, Tiêu đề (Mô tả), Số tiền, Loại (Thu/Chi), Danh mục, Ví</i>.</li>
                <li>Hệ thống tự động phát hiện cột và đối chiếu trùng lặp trước khi lưu.</li>
              </ul>
            </div>
          </div>
        )}

        {step === "mapping" && (
          <div className="import-step-body">
            <div className="mapping-header">
              <p>Tệp: <b>{fileName}</b> ({rawRows.length - 1} dòng dữ liệu)</p>
              <span className="info-badge">Kiểm tra ánh xạ cột</span>
            </div>

            <div className="mapping-grid">
              <label>
                <span>Cột Tiêu đề / Mô tả (*)</span>
                <select
                  value={mapping.titleColumn || ""}
                  onChange={(e) => setMapping({ ...mapping, titleColumn: e.target.value })}
                >
                  <option value="">-- Chọn cột --</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Cột Số tiền (*)</span>
                <select
                  value={mapping.amountColumn || ""}
                  onChange={(e) => setMapping({ ...mapping, amountColumn: e.target.value })}
                >
                  <option value="">-- Chọn cột --</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Cột Ngày giao dịch</span>
                <select
                  value={mapping.dateColumn || ""}
                  onChange={(e) => setMapping({ ...mapping, dateColumn: e.target.value })}
                >
                  <option value="">-- Tự động hôm nay --</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Cột Loại (Thu / Chi)</span>
                <select
                  value={mapping.typeColumn || ""}
                  onChange={(e) => setMapping({ ...mapping, typeColumn: e.target.value })}
                >
                  <option value="">-- Mặc định: Chi tiêu --</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Cột Danh mục</span>
                <select
                  value={mapping.categoryColumn || ""}
                  onChange={(e) => setMapping({ ...mapping, categoryColumn: e.target.value })}
                >
                  <option value="">-- Tự động khớp danh mục --</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Cột Ví thanh toán</span>
                <select
                  value={mapping.walletColumn || ""}
                  onChange={(e) => setMapping({ ...mapping, walletColumn: e.target.value })}
                >
                  <option value="">-- Mặc định: Ví đầu tiên --</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="import-actions">
              <button type="button" className="ghost-btn" onClick={() => setStep("upload")}>
                Chọn lại tệp
              </button>
              <button type="button" className="primary-btn" onClick={handleProceedToPreview}>
                Xem trước dữ liệu ({rawRows.length - 1} dòng)
              </button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="import-step-body">
            <div className="preview-stat-tabs">
              <button
                type="button"
                className={`tab-btn ${filterTab === "all" ? "active" : ""}`}
                onClick={() => setFilterTab("all")}
              >
                Tất cả ({previews.length})
              </button>
              <button
                type="button"
                className={`tab-btn valid ${filterTab === "valid" ? "active" : ""}`}
                onClick={() => setFilterTab("valid")}
              >
                ✓ Hợp lệ ({validCount})
              </button>
              <button
                type="button"
                className={`tab-btn duplicate ${filterTab === "duplicate" ? "active" : ""}`}
                onClick={() => setFilterTab("duplicate")}
              >
                ⚠️ Nghi trùng ({duplicateCount})
              </button>
              <button
                type="button"
                className={`tab-btn invalid ${filterTab === "invalid" ? "active" : ""}`}
                onClick={() => setFilterTab("invalid")}
              >
                ✕ Lỗi ({invalidCount})
              </button>
            </div>

            <div className="duplicate-toggle-box">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />
                <span>Tự động bỏ qua các dòng nghi trùng lặp ({duplicateCount} dòng)</span>
              </label>
            </div>

            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>Trạng thái</th>
                    <th>Ngày</th>
                    <th>Tiêu đề</th>
                    <th>Số tiền</th>
                    <th>Loại</th>
                    <th>Danh mục</th>
                    <th>Ví</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPreviews.slice(0, 100).map((row) => (
                    <tr key={row.rowIndex} className={`status-row-${row.status}`}>
                      <td>
                        {row.status === "valid" && <span className="tag-valid">Hợp lệ</span>}
                        {row.status === "duplicate" && (
                          <span className="tag-duplicate" title={row.duplicateReason}>
                            Nghi trùng
                          </span>
                        )}
                        {row.status === "invalid" && (
                          <span className="tag-invalid" title={row.errorMessage}>
                            Lỗi
                          </span>
                        )}
                      </td>
                      <td>{row.occurredAt.slice(0, 10)}</td>
                      <td>
                        <b>{row.title}</b>
                        {row.duplicateReason && (
                          <div className="preview-sub-err">{row.duplicateReason}</div>
                        )}
                        {row.errorMessage && (
                          <div className="preview-sub-err red">{row.errorMessage}</div>
                        )}
                      </td>
                      <td style={{ fontWeight: 600 }}>{row.amount.toLocaleString("vi-VN")}đ</td>
                      <td>{row.type === "income" ? "Thu" : "Chi"}</td>
                      <td>{row.categoryName || "Khác"}</td>
                      <td>{row.walletName || "Ví"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {displayedPreviews.length > 100 && (
                <p className="preview-trunc-note">
                  Đang hiển thị 100 / {displayedPreviews.length} dòng.
                </p>
              )}
            </div>

            {importing && (
              <div className="progress-bar-wrap">
                <div className="progress-bar" style={{ width: `${progress}%` }} />
                <span>Đang nhập dữ liệu... {progress}%</span>
              </div>
            )}

            <div className="import-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={importing}
                onClick={() => setStep("mapping")}
              >
                Chỉnh sửa cột
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={importing || (validCount === 0 && (skipDuplicates || duplicateCount === 0))}
                onClick={handleExecuteImport}
              >
                {importing
                  ? "Đang xử lý..."
                  : `Xác nhận nhập ${
                      skipDuplicates ? validCount : validCount + duplicateCount
                    } giao dịch`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
