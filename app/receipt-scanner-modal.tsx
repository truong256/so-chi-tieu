"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Budget,
  Category,
  ParsedReceiptResult,
  ReceiptItem,
  ReceiptScanStep,
  TransactionType,
  Wallet,
} from "./finance-types";
import { localDateTime } from "./finance-utils";

interface ReceiptScannerModalProps {
  categories: Category[];
  wallets: Wallet[];
  budgets: Budget[];
  availableBalances: Map<string, number>;
  onClose: () => void;
  onSwitchToManual: () => void;
  onConfirmTransaction: (data: {
    title: string;
    amount: number;
    type: TransactionType;
    categoryId: string;
    walletId: string;
    budgetId: string;
    paymentSourceType: "wallet" | "budget";
    occurredAt: string;
    note: string;
    receiptFile: File | null;
  }) => Promise<void>;
  saving: boolean;
  money: (amount: number) => string;
}

export function FormattedMoneyInput({
  name,
  value,
  defaultValue,
  onChangeValue,
  placeholder,
  required,
  autoFocus,
}: {
  name?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChangeValue?: (val: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [display, setDisplay] = useState<string>(() => {
    const init = value !== undefined ? value : defaultValue;
    if (init === undefined || init === null || String(init) === "") return "";
    const parsed = parseInt(String(init).replace(/\D/g, ""), 10);
    return isNaN(parsed) ? "" : new Intl.NumberFormat("vi-VN").format(parsed);
  });

  useEffect(() => {
    if (value !== undefined) {
      if (String(value) === "") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDisplay("");
      } else {
        const parsed = parseInt(String(value).replace(/\D/g, ""), 10);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDisplay(isNaN(parsed) ? "" : new Intl.NumberFormat("vi-VN").format(parsed));
      }
    }
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const inputVal = e.target.value;
    const digitsOnly = inputVal.replace(/\D/g, "");
    if (!digitsOnly) {
      setDisplay("");
      onChangeValue?.("");
      return;
    }
    const parsed = parseInt(digitsOnly, 10);
    if (isNaN(parsed)) return;
    setDisplay(new Intl.NumberFormat("vi-VN").format(parsed));
    onChangeValue?.(String(parsed));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text");
    const digitsOnly = pastedText.replace(/\D/g, "");
    if (!digitsOnly) {
      setDisplay("");
      onChangeValue?.("");
      return;
    }
    const parsed = parseInt(digitsOnly, 10);
    if (isNaN(parsed)) return;
    setDisplay(new Intl.NumberFormat("vi-VN").format(parsed));
    onChangeValue?.(String(parsed));
  }

  const rawValue = display ? display.replace(/\D/g, "") : "";

  return (
    <div className="amount-input-wrapper">
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        onPaste={handlePaste}
        placeholder={placeholder ?? "0"}
        required={required}
        autoFocus={autoFocus}
      />
      <span className="amount-currency-badge">₫</span>
      {name && <input name={name} type="hidden" value={rawValue} />}
    </div>
  );
}

export default function ReceiptScannerModal({
  categories,
  wallets,
  budgets,
  availableBalances,
  onClose,
  onSwitchToManual,
  onConfirmTransaction,
  saving,
  money,
}: ReceiptScannerModalProps) {
  const [step, setStep] = useState<ReceiptScanStep>("select");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveReceiptToStorage, setSaveReceiptToStorage] = useState(true);
  const [showFullReceiptPreview, setShowFullReceiptPreview] = useState(false);

  // Form Fields after parsing
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionType, setTransactionType] = useState<TransactionType>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [paymentSourceType, setPaymentSourceType] = useState<"wallet" | "budget">("wallet");
  const [occurredAt, setOccurredAt] = useState(localDateTime());
  const [note, setNote] = useState("");
  const [parsedData, setParsedData] = useState<ParsedReceiptResult | null>(null);

  // Loading animation checklist state
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Cleanup object URL when previewUrl changes or component unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Loading animation step timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (step === "loading") {
      setLoadingStepIndex(0);
      interval = setInterval(() => {
        setLoadingStepIndex((prev) => (prev < 4 ? prev + 1 : prev));
      }, 700);
    }
    return () => clearInterval(interval);
  }, [step]);

  function handleFileSelected(file: File) {
    setErrorMessage(null);

    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("Kích thước tệp quá lớn. Vui lòng chọn ảnh nhỏ hơn 10 MB.");
      return;
    }

    // Validate type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!validTypes.includes(file.type.toLowerCase())) {
      setErrorMessage("Định dạng tệp không được hỗ trợ. Vui lòng chọn ảnh JPG, PNG hoặc WebP.");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
    setStep("preview");
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  }

  function handleResetImage() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setParsedData(null);
    setErrorMessage(null);
    setStep("select");
  }

  async function handleAnalyzeReceipt() {
    if (!selectedFile) return;

    setStep("loading");
    setErrorMessage(null);

    try {
      // Get auth token from supabase browser client session
      const { createClient } = await import("../lib/supabase/client");
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error("Chưa đăng nhập. Vui lòng đăng nhập lại.");
      }

      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("categories", JSON.stringify(categories.map((c) => c.name)));
      formData.append("wallets", JSON.stringify(wallets.map((w) => w.name)));

      const response = await fetch("/api/receipt/parse", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const resJson = await response.json();

      if (!response.ok || !resJson.success) {
        throw new Error(resJson.error || "Không thể phân tích hóa đơn. Vui lòng thử lại.");
      }

      const result: ParsedReceiptResult = resJson.data;
      setParsedData(result);

      if (!result.is_receipt && result.document_type === "other") {
        setErrorMessage("Hình ảnh không chứa hóa đơn hoặc chứng từ mua sắm hợp lệ. Vui lòng chụp lại hóa đơn rõ nét hơn.");
        setStep("error");
        return;
      }

      // Populate form state from parsed result
      const parsedTitle = result.description
        ? result.description
        : result.merchant
        ? `Mua tại ${result.merchant}`
        : "Chi tiêu theo hóa đơn";
      setTitle(parsedTitle);

      if (result.total && result.total > 0) {
        setAmount(String(result.total));
      } else {
        setAmount("");
      }

      setTransactionType(result.transaction_type || "expense");

      // Match category
      let matchedCatId = "";
      if (result.category) {
        const found = categories.find(
          (c) => c.name.toLowerCase() === result.category?.toLowerCase() && c.kind === result.transaction_type
        );
        if (found) matchedCatId = found.id;
      }
      if (!matchedCatId) {
        const defaultCat = categories.find((c) => c.kind === (result.transaction_type || "expense"));
        matchedCatId = defaultCat?.id || "";
      }
      setCategoryId(matchedCatId);

      // Match payment wallet
      let matchedWalletId = wallets[0]?.id || "";
      if (result.payment_method) {
        const pmLower = result.payment_method.toLowerCase();
        if (pmLower.includes("tiền mặt") || pmLower.includes("cash")) {
          const cashW = wallets.find((w) => w.type === "cash");
          if (cashW) matchedWalletId = cashW.id;
        } else if (pmLower.includes("thẻ") || pmLower.includes("card") || pmLower.includes("bank") || pmLower.includes("chuyển khoản")) {
          const bankW = wallets.find((w) => w.type === "bank");
          if (bankW) matchedWalletId = bankW.id;
        } else if (pmLower.includes("momo") || pmLower.includes("vnpay") || pmLower.includes("zalopay")) {
          const eW = wallets.find((w) => w.type === "ewallet");
          if (eW) matchedWalletId = eW.id;
        }
      }
      setWalletId(matchedWalletId);
      setPaymentSourceType("wallet");
      setBudgetId("");

      // Date and Time normalization
      if (result.date) {
        const timePart = result.time || "12:00";
        setOccurredAt(`${result.date}T${timePart}`);
      } else {
        setOccurredAt(localDateTime());
      }

      // Build structured note
      const noteLines: string[] = [];
      if (result.merchant) noteLines.push(`Cửa hàng: ${result.merchant}`);
      if (result.merchant_address) noteLines.push(`Địa chỉ: ${result.merchant_address}`);
      if (result.payment_method) noteLines.push(`Hình thức TT: ${result.payment_method}`);
      if (result.items && result.items.length > 0) {
        noteLines.push(`Sản phẩm (${result.items.length} món):`);
        result.items.slice(0, 5).forEach((it: ReceiptItem) => {
          const qty = it.quantity ? `${it.quantity}x ` : "";
          const price = it.total_price ? ` (${money(it.total_price)})` : "";
          noteLines.push(`- ${qty}${it.name}${price}`);
        });
        if (result.items.length > 5) {
          noteLines.push(`... và ${result.items.length - 5} sản phẩm khác`);
        }
      }
      setNote(noteLines.join("\n"));

      setStep("result");
    } catch (err: any) {
      console.error("Analysis error:", err);
      setErrorMessage(err.message || "Không thể phân tích hóa đơn. Vui lòng thử lại.");
      setStep("error");
    }
  }

  async function handleFinalSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      alert("Vui lòng nhập tên giao dịch.");
      return;
    }

    const numAmount = parseInt(amount.replace(/\D/g, ""), 10);
    if (isNaN(numAmount) || numAmount <= 0) {
      alert("Số tiền giao dịch phải lớn hơn 0. Vui lòng nhập số tiền hợp lệ.");
      return;
    }

    if (!categoryId) {
      alert("Vui lòng chọn danh mục.");
      return;
    }

    if (paymentSourceType === "wallet" && !walletId) {
      alert("Vui lòng chọn ví thanh toán.");
      return;
    }

    if (paymentSourceType === "budget" && !budgetId) {
      alert("Vui lòng chọn ngân sách thanh toán.");
      return;
    }

    await onConfirmTransaction({
      title: title.trim(),
      amount: numAmount,
      type: transactionType,
      categoryId,
      walletId,
      budgetId,
      paymentSourceType,
      occurredAt,
      note: note.trim(),
      receiptFile: saveReceiptToStorage ? selectedFile : null,
    });
  }

  const checklistItems = [
    { label: "Cửa hàng & Thương hiệu", done: loadingStepIndex >= 0 },
    { label: "Ngày & Giờ giao dịch", done: loadingStepIndex >= 1 },
    { label: "Tổng tiền thanh toán", done: loadingStepIndex >= 2 },
    { label: "Danh mục chi tiêu phù hợp", done: loadingStepIndex >= 3 },
    { label: "Danh sách sản phẩm & Chi tiết", done: loadingStepIndex >= 4 },
  ];

  return (
    <div className="modal-wrap receipt-modal-wrap" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title">
      <button className="modal-backdrop" onClick={onClose} aria-label="Đóng" />

      <section className="receipt-scanner-modal">
        {/* Modal Header */}
        <div className="receipt-modal-head">
          <div className="receipt-head-info">
            <div className="receipt-badge-row">
              <span className="receipt-ai-pill">✦ AI MULTIMODAL</span>
              <span className="receipt-eyebrow">QUÉT HÓA ĐƠN THÔNG MINH</span>
            </div>
            <h2 id="receipt-modal-title">Quét hóa đơn bằng AI</h2>
            <p className="receipt-modal-sub">
              Tải lên hoặc chụp ảnh hóa đơn để AI tự động nhận diện cửa hàng, số tiền và sản phẩm.
            </p>
          </div>
          <button type="button" className="receipt-close-btn" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        {/* Mode switch tabs: Manual vs AI Scan */}
        <div className="receipt-mode-tabs">
          <button
            type="button"
            className="receipt-tab-btn"
            onClick={onSwitchToManual}
          >
            <span>✏️</span> Nhập thủ công
          </button>
          <button
            type="button"
            className="receipt-tab-btn active"
          >
            <span>📷</span> Quét hóa đơn bằng AI
          </button>
        </div>

        {/* Step 1: Select / Dropzone */}
        {step === "select" && (
          <div className="receipt-step-content">
            <div
              className={`receipt-dropzone ${dragOver ? "active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="receipt-dropzone-icon-wrap">
                <span className="receipt-scan-beam" />
                <span className="receipt-camera-emoji">📷</span>
              </div>

              <h3 className="receipt-dropzone-title">Kéo thả ảnh hóa đơn vào đây</h3>
              <p className="receipt-dropzone-desc">Hỗ trợ JPG, JPEG, PNG, WebP · Tối đa 10 MB</p>

              <div className="receipt-upload-actions">
                <button
                  type="button"
                  className="receipt-browse-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span>📁</span> Chọn ảnh từ máy
                </button>

                <button
                  type="button"
                  className="receipt-camera-btn"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <span>📸</span> Chụp ảnh hóa đơn
                </button>
              </div>

              {/* Hidden file inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden-file-input"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFileSelected(e.target.files[0]);
                  }
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden-file-input"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFileSelected(e.target.files[0]);
                  }
                }}
              />
            </div>

            {errorMessage && (
              <div className="receipt-error-banner">
                <span>⚠️</span>
                <p>{errorMessage}</p>
              </div>
            )}

            <div className="receipt-guide-box">
              <h4>💡 Mẹo để AI nhận diện hóa đơn chính xác nhất:</h4>
              <ul>
                <li>Chụp ảnh đủ sáng, căn thẳng hóa đơn trong khung hình.</li>
                <li>Đảm bảo thấy rõ tên cửa hàng, ngày tháng và dòng Tổng tiền.</li>
                <li>Tránh bóng sấp hoặc hóa đơn bị nhàu, gập che mất số tiền.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Step 2: Image Preview */}
        {step === "preview" && previewUrl && (
          <div className="receipt-step-content preview-step">
            <div className="receipt-preview-header">
              <h3>Hóa đơn đã chọn</h3>
              <span className="receipt-file-name">
                {selectedFile?.name} ({(selectedFile ? selectedFile.size / 1024 : 0).toFixed(0)} KB)
              </span>
            </div>

            <div className="receipt-preview-card">
              <div className="receipt-img-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Xem trước hóa đơn"
                  className="receipt-preview-img"
                />
              </div>
            </div>

            {errorMessage && (
              <div className="receipt-error-banner">
                <span>⚠️</span>
                <p>{errorMessage}</p>
              </div>
            )}

            <div className="receipt-preview-actions">
              <button
                type="button"
                className="receipt-secondary-btn"
                onClick={handleResetImage}
              >
                <span>🔄</span> Chọn ảnh khác
              </button>

              <button
                type="button"
                className="receipt-primary-btn"
                onClick={handleAnalyzeReceipt}
              >
                <span>✨ Phân tích hóa đơn →</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Loading animation */}
        {step === "loading" && (
          <div className="receipt-step-content loading-step">
            <div className="receipt-loading-card">
              <div className="receipt-spinner-wrap">
                <div className="receipt-pulse-ring" />
                <div className="receipt-scanner-icon">
                  <span>📄</span>
                </div>
              </div>

              <h3 className="receipt-loading-title">Đang phân tích hóa đơn...</h3>
              <p className="receipt-loading-sub">
                AI đang trích xuất dữ liệu chi tiêu có cấu trúc từ hình ảnh
              </p>

              <div className="receipt-checklist">
                {checklistItems.map((item, idx) => (
                  <div
                    key={idx}
                    className={`receipt-checklist-row ${item.done ? "done" : "pending"}`}
                  >
                    <span className="receipt-check-badge">
                      {item.done ? "✓" : "○"}
                    </span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Parsed Result & Editable Confirmation Form */}
        {step === "result" && (
          <form className="receipt-step-content result-step" onSubmit={handleFinalSubmit}>
            <div className="receipt-result-top-banner">
              <div className="receipt-banner-left">
                <span className="receipt-success-icon">✨</span>
                <div>
                  <strong>AI đã nhận diện thành công hóa đơn</strong>
                  <p>Hãy kiểm tra lại thông tin và chỉnh sửa nếu cần trước khi tạo giao dịch.</p>
                </div>
              </div>
              <button
                type="button"
                className="receipt-rescan-btn"
                onClick={handleResetImage}
                title="Quét ảnh khác"
              >
                <span>🔄</span> Đổi ảnh khác
              </button>
            </div>

            {/* Warnings list if any critical field is missing */}
            {parsedData?.warnings && parsedData.warnings.length > 0 && (
              <div className="receipt-warning-card">
                <span className="warning-card-icon">⚠️</span>
                <div className="warning-card-content">
                  <b>Cần lưu ý:</b>
                  <ul>
                    {parsedData.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="receipt-result-layout">
              {/* Left Column: Image Thumbnail & Line Items */}
              <div className="receipt-result-left">
                <div className="receipt-thumb-box">
                  <div className="receipt-thumb-header">
                    <span>Ảnh hóa đơn gốc</span>
                    <button
                      type="button"
                      className="receipt-zoom-btn"
                      onClick={() => setShowFullReceiptPreview((v) => !v)}
                    >
                      {showFullReceiptPreview ? "Thu nhỏ ⤓" : "Phóng to 🔍"}
                    </button>
                  </div>
                  <div
                    className={`receipt-thumb-wrapper ${showFullReceiptPreview ? "expanded" : ""}`}
                    onClick={() => setShowFullReceiptPreview((v) => !v)}
                  >
                    {previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="Hóa đơn" className="receipt-thumb-img" />
                    )}
                  </div>
                </div>

                {/* Line Items Table if present */}
                {parsedData?.items && parsedData.items.length > 0 && (
                  <div className="receipt-items-card">
                    <div className="receipt-items-head">
                      <span>Chi tiết sản phẩm ({parsedData.items.length})</span>
                    </div>
                    <div className="receipt-items-list">
                      {parsedData.items.map((item, index) => (
                        <div className="receipt-item-row" key={index}>
                          <div className="receipt-item-name">
                            {item.quantity && item.quantity > 1 && (
                              <span className="item-qty-badge">{item.quantity}x</span>
                            )}
                            <span>{item.name}</span>
                          </div>
                          <div className="receipt-item-price">
                            {item.total_price ? money(item.total_price) : item.unit_price ? money(item.unit_price) : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Editable Form */}
              <div className="receipt-result-right">
                {/* Transaction Type Toggle */}
                <div className="type-toggle">
                  <button
                    type="button"
                    className={transactionType === "expense" ? "active" : ""}
                    onClick={() => setTransactionType("expense")}
                  >
                    Khoản chi
                  </button>
                  <button
                    type="button"
                    className={transactionType === "income" ? "active" : ""}
                    onClick={() => setTransactionType("income")}
                  >
                    Khoản thu
                  </button>
                </div>

                <label>
                  Tên giao dịch / Cửa hàng
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ví dụ: Circle K, Highland Coffee…"
                  />
                </label>

                <label>
                  Tổng tiền thanh toán
                  <FormattedMoneyInput
                    required
                    value={amount}
                    onChangeValue={(val) => setAmount(val)}
                    placeholder="0"
                  />
                </label>

                <label>
                  Danh mục
                  <select
                    required
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">-- Chọn danh mục --</option>
                    {categories
                      .filter((c) => c.kind === transactionType)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>

                {/* Payment Source Selection (Wallet or Budget) */}
                {transactionType === "expense" ? (
                  <div className="payment-source-group">
                    <label className="payment-source-label">⎨ Nguồn thanh toán</label>
                    <div className="payment-source-options">
                      {/* Matching Budgets */}
                      {budgets.filter((b) => b.status === "active" && b.remaining_amount > 0 && (!b.category_id || b.category_id === categoryId)).length > 0 && (
                        <div className="payment-source-section">
                          <div className="ps-section-title">NGÂN SÁCH</div>
                          {budgets
                            .filter((b) => b.status === "active" && b.remaining_amount > 0 && (!b.category_id || b.category_id === categoryId))
                            .map((b) => {
                              const avail = b.remaining_amount;
                              const numVal = parseInt(amount.replace(/\D/g, ""), 10) || 0;
                              const isInsufficient = numVal > 0 && numVal > avail;
                              const isSelected = paymentSourceType === "budget" && budgetId === b.id;

                              return (
                                <label
                                  key={b.id}
                                  className={`payment-source-option ${isSelected ? "selected" : ""} ${isInsufficient ? "insufficient" : ""}`}
                                >
                                  <input
                                    type="radio"
                                    name="receiptPaymentSource"
                                    value={b.id}
                                    checked={isSelected}
                                    onChange={() => {
                                      setPaymentSourceType("budget");
                                      setBudgetId(b.id);
                                      setWalletId("");
                                    }}
                                  />
                                  <div className="ps-left">
                                    <div className="ps-radio-indicator">
                                      <span className="ps-radio-dot" />
                                    </div>
                                    <div className="ps-info">
                                      <span className="ps-badge budget">◉ {b.name}</span>
                                      {isInsufficient && <span className="insufficient-badge">Không đủ số dư</span>}
                                    </div>
                                  </div>
                                  <div className="ps-right">
                                    <span className={`ps-balance ${isInsufficient ? "insufficient-text" : ""}`}>
                                      {money(avail)} còn lại
                                    </span>
                                  </div>
                                </label>
                              );
                            })}
                        </div>
                      )}

                      {/* Wallets */}
                      <div className="payment-source-section">
                        <div className="ps-section-title">VÍ / TÀI KHOẢN</div>
                        {wallets.map((w) => {
                          const avail = availableBalances.get(w.id) ?? 0;
                          const numVal = parseInt(amount.replace(/\D/g, ""), 10) || 0;
                          const isInsufficient = numVal > 0 && numVal > avail;
                          const isSelected = paymentSourceType === "wallet" && walletId === w.id;

                          return (
                            <label
                              key={w.id}
                              className={`payment-source-option ${isSelected ? "selected" : ""} ${isInsufficient ? "insufficient" : ""}`}
                            >
                              <input
                                type="radio"
                                name="receiptPaymentSource"
                                value={w.id}
                                checked={isSelected}
                                onChange={() => {
                                  setPaymentSourceType("wallet");
                                  setWalletId(w.id);
                                  setBudgetId("");
                                }}
                              />
                              <div className="ps-left">
                                <div className="ps-radio-indicator">
                                  <span className="ps-radio-dot" />
                                </div>
                                <div className="ps-info">
                                  <span className="ps-badge wallet">
                                    {w.icon} {w.name}
                                  </span>
                                  {isInsufficient && <span className="insufficient-badge">Không đủ số dư</span>}
                                </div>
                              </div>
                              <div className="ps-right">
                                <span className={`ps-balance ${isInsufficient ? "insufficient-text" : ""}`}>
                                  {money(avail)} khả dụng
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <label>
                    Ví nhận tiền
                    <select
                      required
                      value={walletId}
                      onChange={(e) => setWalletId(e.target.value)}
                    >
                      {wallets.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.icon} {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="form-grid">
                  <label>
                    Ngày &amp; giờ
                    <input
                      required
                      type="datetime-local"
                      value={occurredAt}
                      onChange={(e) => setOccurredAt(e.target.value)}
                    />
                  </label>
                </div>

                <label>
                  Ghi chú &amp; Chi tiết
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ghi chú thêm về khoản chi..."
                  />
                </label>

                {/* Save receipt attachment option */}
                <div className="receipt-attachment-toggle">
                  <label className="receipt-checkbox-label">
                    <input
                      type="checkbox"
                      checked={saveReceiptToStorage}
                      onChange={(e) => setSaveReceiptToStorage(e.target.checked)}
                    />
                    <span>Lưu ảnh hóa đơn này đính kèm vào giao dịch</span>
                  </label>
                </div>

                {/* Action Buttons */}
                <div className="receipt-form-actions">
                  <button
                    type="button"
                    className="receipt-back-btn"
                    onClick={handleResetImage}
                    disabled={saving}
                  >
                    <span>🔄</span> Quét lại
                  </button>

                  <button
                    type="submit"
                    className="receipt-submit-btn"
                    disabled={saving}
                  >
                    {saving ? "Đang tạo giao dịch…" : "✓ Xác nhận tạo giao dịch →"}
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}

        {/* Step 5: Error / Non-receipt State */}
        {step === "error" && (
          <div className="receipt-step-content error-step">
            <div className="receipt-error-card">
              <div className="receipt-error-icon-box">
                <span>⚠️</span>
              </div>
              <h3>Không thể nhận diện hóa đơn</h3>
              <p>
                {errorMessage ||
                  "Ảnh có thể bị mờ, thiếu sáng, bị che khuất hoặc không chứa thông tin giao dịch mua sắm."}
              </p>

              <div className="receipt-error-actions">
                <button
                  type="button"
                  className="receipt-primary-btn"
                  onClick={handleResetImage}
                >
                  <span>📷 Chọn / Chụp ảnh khác</span>
                </button>
                <button
                  type="button"
                  className="receipt-secondary-btn"
                  onClick={onSwitchToManual}
                >
                  <span>✏️ Chuyển sang nhập thủ công</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
