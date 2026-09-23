"use client";

import { useMemo, useState } from "react";
import type { Category, Transaction, Wallet } from "../types/finance.types";
import { calculateFinancialInsights } from "../services/financial-insights.service";

interface MonthlyReviewModalProps {
  transactions: Transaction[];
  categories: Category[];
  wallets: Wallet[];
  onClose: () => void;
  formatMoney: (amount: number) => string;
  showNotice: (msg: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exportPayload: any;
}

export default function MonthlyReviewModal({
  transactions,
  categories,
  onClose,
  formatMoney,
  showNotice,
  exportPayload,
}: MonthlyReviewModalProps) {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-12
  const [downloading, setDownloading] = useState(false);

  const referenceDate = useMemo(() => {
    return new Date(selectedYear, selectedMonth - 1, 15);
  }, [selectedYear, selectedMonth]);

  const insights = useMemo(() => {
    return calculateFinancialInsights(transactions, categories, [], [], referenceDate);
  }, [transactions, categories, referenceDate]);

  const handleDownloadMonthlyExcel = async () => {
    setDownloading(true);
    try {
      // Filter transactions for this specific month
      const startOfMonth = new Date(selectedYear, selectedMonth - 1, 1);
      const endOfMonth = new Date(selectedYear, selectedMonth, 1);
      const filteredTxs = transactions.filter((t) => {
        const d = new Date(t.occurred_at);
        return d >= startOfMonth && d < endOfMonth;
      });

      const payload = {
        ...exportPayload,
        transactions: filteredTxs,
        monthTotals: {
          income: insights.currentIncome,
          expense: insights.currentExpense,
        },
      };

      const { exportFinancialDataToExcel } = await import("../services/excel-export");
      await exportFinancialDataToExcel(payload);
      showNotice(`Đã xuất báo cáo Excel tháng ${selectedMonth}/${selectedYear}.`);
    } catch (err) {
      console.error("Monthly Excel export error:", err);
      showNotice("Không thể xuất báo cáo Excel.");
    } finally {
      setDownloading(false);
    }
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true">
      <button className="modal-backdrop" onClick={onClose} aria-label="Đóng" />
      <div className="review-modal-card">
        <div className="modal-head">
          <div>
            <p className="eyebrow">BÁO CÁO THÁNG CHUYÊN SÂU</p>
            <h2>Đánh giá tài chính tháng</h2>
          </div>
          <button type="button" className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="review-month-selector">
          <div className="selector-group">
            <span>Chọn kỳ báo cáo:</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  Tháng {m}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  Năm {y}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="secondary-btn"
            disabled={downloading}
            onClick={handleDownloadMonthlyExcel}
          >
            {downloading ? "Đang xuất..." : "Tải Excel tháng này"}
          </button>
        </div>

        <div className="review-metrics-grid">
          <div className="review-metric-box income">
            <p className="metric-label">Tổng thu nhập</p>
            <h3 className="metric-value">{formatMoney(insights.currentIncome)}</h3>
            <span className="metric-sub">
              {insights.incomeChangePercent > 0 ? "+" : ""}
              {insights.incomeChangePercent}% so với tháng trước
            </span>
          </div>

          <div className="review-metric-box expense">
            <p className="metric-label">Tổng chi tiêu</p>
            <h3 className="metric-value">{formatMoney(insights.currentExpense)}</h3>
            <span className="metric-sub">
              {insights.expenseChangePercent > 0 ? "+" : ""}
              {insights.expenseChangePercent}% so với tháng trước
            </span>
          </div>

          <div className={`review-metric-box cashflow ${insights.netCashFlow >= 0 ? "positive" : "negative"}`}>
            <p className="metric-label">Dòng tiền ròng</p>
            <h3 className="metric-value">
              {insights.netCashFlow >= 0 ? "+" : ""}
              {formatMoney(insights.netCashFlow)}
            </h3>
            <span className="metric-sub">
              Trung bình: {formatMoney(insights.dailyAverageExpense)}/ngày
            </span>
          </div>

          <div className="review-metric-box savings">
            <p className="metric-label">Tỷ lệ tích lũy (Savings rate)</p>
            <h3 className="metric-value">{insights.savingsRate}%</h3>
            <span className={`metric-sub ${insights.savingsRate >= 20 ? "green" : "orange"}`}>
              {insights.savingsRate >= 30
                ? "Xuất sắc"
                : insights.savingsRate >= 20
                ? "Đạt chuẩn"
                : insights.savingsRate > 0
                ? "Cần cải thiện"
                : "Bội chi"}
            </span>
          </div>
        </div>

        {/* Top Spending Categories */}
        <div className="review-section">
          <h4>Phân bổ chi tiêu theo nhóm</h4>
          {insights.topCategories.length === 0 ? (
            <p className="empty-hint">Không có chi tiêu nào được ghi nhận trong tháng này.</p>
          ) : (
            <div className="review-categories-list">
              {insights.topCategories.map((c) => (
                <div key={c.id} className="review-category-row">
                  <div className="cat-meta">
                    <span className="cat-color-dot" style={{ background: c.color }} />
                    <span className="cat-name">{c.name}</span>
                    <span className="cat-percent">{c.percentage}%</span>
                  </div>
                  <div className="cat-bar-wrap">
                    <div
                      className="cat-bar"
                      style={{ width: `${c.percentage}%`, background: c.color }}
                    />
                  </div>
                  <span className="cat-amount">{formatMoney(c.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category Comparisons vs Previous Month */}
        {insights.categoryComparisons.some((c) => c.previousAmount > 0) && (
          <div className="review-section">
            <h4>Biến động so với tháng trước</h4>
            <div className="review-comparison-grid">
              {insights.categoryComparisons
                .filter((c) => c.previousAmount > 0)
                .slice(0, 4)
                .map((cmp) => (
                  <div key={cmp.categoryId} className="comparison-card">
                    <div className="cmp-header">
                      <b>{cmp.categoryName}</b>
                      <span className={`cmp-badge ${cmp.percentChange > 0 ? "up" : "down"}`}>
                        {cmp.percentChange > 0 ? "+" : ""}
                        {cmp.percentChange}%
                      </span>
                    </div>
                    <div className="cmp-body">
                      <span>Hiện tại: {formatMoney(cmp.currentAmount)}</span>
                      <span>Tháng trước: {formatMoney(cmp.previousAmount)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Smart Insights & Recommendations */}
        <div className="review-section">
          <h4>Nhận định tài chính từ hệ thống</h4>
          {insights.insightBullets.length === 0 ? (
            <p className="empty-hint">Chưa đủ dữ liệu giao dịch để đưa ra nhận định.</p>
          ) : (
            <ul className="review-insights-bullets">
              {insights.insightBullets.map((bullet, idx) => (
                <li key={idx}>{bullet}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Anomalies if any */}
        {insights.anomalies.length > 0 && (
          <div className="review-section warning-box">
            <h4>Cảnh báo chi tiêu đáng chú ý</h4>
            {insights.anomalies.map((a) => (
              <div key={a.id} className="review-anomaly-item">
                <b>{a.title}:</b> {a.description}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
