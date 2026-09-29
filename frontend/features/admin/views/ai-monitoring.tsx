"use client";

import React, { useEffect, useState } from "react";
import AdminHeader from "../admin-header";
import AdminStatCard from "../components/admin-stat-card";
import type { AiMonitoringData } from "../admin.types";

interface AiMonitoringProps {
  getAuthToken: () => Promise<string | null>;
}

export default function AiMonitoringView({ getAuthToken }: AiMonitoringProps) {
  const [data, setData] = useState<AiMonitoringData | null>(null);
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchAiStats() {
      try {
        setLoading(true);
        setError(null);

        const token = await getAuthToken();
        if (!token) throw new Error("Chưa có phiên đăng nhập.");

        const res = await fetch(`/api/admin/ai-usage?period=${period}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Không thể tải số liệu AI.");
        }

        const json = await res.json();
        if (active) setData(json);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchAiStats();

    return () => {
      active = false;
    };
  }, [getAuthToken, period]);

  const periodLabel =
    period === "today" ? "Hôm nay" : period === "7d" ? "7 ngày qua" : "30 ngày qua";

  return (
    <div className="admin-view-container">
      <AdminHeader
        title="AI Monitoring"
        subtitle="Giám sát hiệu năng mô hình ngôn ngữ, độ trễ và tỷ lệ thành công của các tác vụ AI."
        actions={
          <div className="admin-tab-group" role="tablist">
            <button
              type="button"
              className={`admin-tab-btn ${period === "today" ? "active" : ""}`}
              onClick={() => setPeriod("today")}
              role="tab"
              aria-selected={period === "today"}
            >
              Hôm nay
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${period === "7d" ? "active" : ""}`}
              onClick={() => setPeriod("7d")}
              role="tab"
              aria-selected={period === "7d"}
            >
              7 ngày
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${period === "30d" ? "active" : ""}`}
              onClick={() => setPeriod("30d")}
              role="tab"
              aria-selected={period === "30d"}
            >
              30 ngày
            </button>
          </div>
        }
      />

      {error && (
        <div className="admin-alert admin-alert-danger" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="admin-loading-placeholder">
          <div className="admin-spinner" />
          <span>Đang tải số liệu giám sát AI...</span>
        </div>
      ) : data ? (
        <>
          {/* Key Telemetry Stats */}
          <div className="admin-stats-grid">
            <AdminStatCard
              label={`Tổng yêu cầu (${periodLabel})`}
              value={data.totalRequests.toLocaleString("vi-VN")}
              sublabel="Các yêu cầu gọi mô hình Gemini"
            />
            <AdminStatCard
              label="Tỷ lệ thành công"
              value={`${data.successRate}%`}
              sublabel={data.successRate >= 95 ? "Ổn định cao" : "Cần theo dõi"}
              variant="highlight"
            />
            <AdminStatCard
              label="Số lượng lỗi"
              value={data.errorCount.toLocaleString("vi-VN")}
              sublabel="Lỗi timeout hoặc từ chối phản hồi"
              variant={data.errorCount > 0 ? "dark" : "default"}
            />
            <AdminStatCard
              label="Độ trễ trung bình"
              value={`${data.avgLatencyMs.toLocaleString("vi-VN")} ms`}
              sublabel="Thời gian xử lý mạng và sinh văn bản"
            />
          </div>

          {/* AI Model Classification Canary Status */}
          {data.canary && (
            <div className="admin-card">
              <div className="admin-card-header">
                <h2 className="admin-card-title">AI Classification Canary (V3 Primary / V4 5% Canary)</h2>
                <span className="admin-card-subtitle">
                  Trạng thái triển khai an toàn mô hình phân loại giao dịch
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", padding: "1rem" }}>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Primary / Canary Model</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px" }}>
                    V3 (95%) / V4 (5%)
                  </div>
                </div>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Circuit Breaker</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px", color: data.canary.circuitBreaker === "CLOSED" ? "#10b981" : "#ef4444" }}>
                    {data.canary.circuitBreaker} (Bình thường)
                  </div>
                </div>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Real Traffic Events</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px" }}>
                    {data.canary.realEventsProgress}
                  </div>
                </div>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Promotion Gate (&gt;5%)</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px", color: data.canary.promotionGate === "BLOCKED" ? "#f59e0b" : "#10b981" }}>
                    {data.canary.promotionGate} (Cần &ge;500 sự kiện thật)
                  </div>
                </div>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>V3 / V4 Request Distribution</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px" }}>
                    {data.canary.v3Requests} V3 / {data.canary.v4Requests} V4
                  </div>
                </div>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>V4 Latency p95 / Success</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px" }}>
                    {data.canary.v4LatencyP95} ms / {data.canary.v4SuccessRate}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI Suggestion & Correction Quality Feedback Loop */}
          {data.feedback && (
            <div className="admin-card">
              <div className="admin-card-header">
                <h2 className="admin-card-title">Chất lượng gợi ý danh mục (Feedback Loop)</h2>
                <span className="admin-card-subtitle">
                  Theo dõi phản hồi chấp nhận hoặc sửa đổi gợi ý từ người dùng thực (tuyệt đối không lưu text giao dịch)
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", padding: "1rem" }}>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Tỷ lệ chấp nhận gợi ý</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px", color: data.feedback.acceptanceRate >= 70 ? "#10b981" : "#f59e0b" }}>
                    {data.feedback.totalEvents > 0 ? `${data.feedback.acceptanceRate}%` : "Chưa có dữ liệu"}
                  </div>
                  <div style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: "2px" }}>
                    {data.feedback.totalEvents} lượt phản hồi ghi nhận
                  </div>
                </div>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Tỷ lệ người dùng sửa đổi</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px", color: data.feedback.correctionRate > 30 ? "#ef4444" : "#10b981" }}>
                    {data.feedback.totalEvents > 0 ? `${data.feedback.correctionRate}%` : "0%"}
                  </div>
                  <div style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: "2px" }}>
                    Sửa đổi danh mục khi AI đề xuất
                  </div>
                </div>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Sửa khi tự tin cao (High-Conf)</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px", color: data.feedback.highConfidenceCorrectionRate > 15 ? "#ef4444" : "#10b981" }}>
                    {data.feedback.totalEvents > 0 ? `${data.feedback.highConfidenceCorrectionRate}%` : "0%"}
                  </div>
                  <div style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: "2px" }}>
                    Chỉ số phát hiện gợi ý sai tự tin cao
                  </div>
                </div>
                <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>V3 vs V4 Chấp nhận</div>
                  <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "4px" }}>
                    {data.feedback.v3AcceptanceRate}% V3 / {data.feedback.v4AcceptanceRate}% V4
                  </div>
                  <div style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: "2px" }}>
                    So sánh thực nghiệm Control vs Canary
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Time Series Activity Bar Chart */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Tần suất yêu cầu AI theo thời gian ({periodLabel})</h2>
              <span className="admin-card-subtitle">
                Biểu đồ số lượt xử lý thành công và lỗi phát sinh
              </span>
            </div>
            <div className="admin-chart-container">
              <div className="admin-bar-chart">
                {data.timeSeries.map((item, idx) => {
                  const maxVal = Math.max(1, ...data.timeSeries.map((t) => t.total));
                  const heightPercent = Math.max(8, Math.round((item.total / maxVal) * 100));
                  return (
                    <div key={idx} className="chart-bar-group">
                      <div className="chart-bar-wrap">
                        <div
                          className="chart-bar"
                          style={{ height: `${heightPercent}%` }}
                          title={`${item.label}: ${item.total} yêu cầu (${item.errors} lỗi)`}
                        />
                      </div>
                      <span className="chart-bar-value">{item.total}</span>
                      <span className="chart-bar-label">{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Feature Distribution */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Khối lượng dịch vụ theo tính năng</h2>
              <span className="admin-card-subtitle">
                Chi tiết các điểm chạm trí tuệ nhân tạo trong ứng dụng
              </span>
            </div>
            <div className="admin-breakdown-list">
              <div className="breakdown-item">
                <div className="breakdown-header">
                  <div>
                    <span className="breakdown-name">Chat Assistant (/api/chat)</span>
                    <p className="breakdown-desc">Trợ lý hội thoại và giải đáp chi tiêu thông minh</p>
                  </div>
                  <span className="breakdown-count">
                    {data.featureBreakdown.chat} lượt ({data.totalRequests > 0 ? Math.round((data.featureBreakdown.chat / data.totalRequests) * 100) : 0}%)
                  </span>
                </div>
                <div className="breakdown-track">
                  <div
                    className="breakdown-fill fill-primary"
                    style={{
                      width: `${data.totalRequests > 0 ? (data.featureBreakdown.chat / data.totalRequests) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              <div className="breakdown-item">
                <div className="breakdown-header">
                  <div>
                    <span className="breakdown-name">Transaction Parser (/api/ai/parse-transaction)</span>
                    <p className="breakdown-desc">Tự động trích xuất ví, danh mục và số tiền từ câu nói tự nhiên</p>
                  </div>
                  <span className="breakdown-count">
                    {data.featureBreakdown.parseTransaction} lượt ({data.totalRequests > 0 ? Math.round((data.featureBreakdown.parseTransaction / data.totalRequests) * 100) : 0}%)
                  </span>
                </div>
                <div className="breakdown-track">
                  <div
                    className="breakdown-fill fill-accent"
                    style={{
                      width: `${data.totalRequests > 0 ? (data.featureBreakdown.parseTransaction / data.totalRequests) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              <div className="breakdown-item">
                <div className="breakdown-header">
                  <div>
                    <span className="breakdown-name">Receipt Scanner (/api/receipt/parse)</span>
                    <p className="breakdown-desc">Đọc hóa đơn ảnh, nhận dạng bảng giá và nội dung mua sắm</p>
                  </div>
                  <span className="breakdown-count">
                    {data.featureBreakdown.receiptParse} lượt ({data.totalRequests > 0 ? Math.round((data.featureBreakdown.receiptParse / data.totalRequests) * 100) : 0}%)
                  </span>
                </div>
                <div className="breakdown-track">
                  <div
                    className="breakdown-fill fill-neutral"
                    style={{
                      width: `${data.totalRequests > 0 ? (data.featureBreakdown.receiptParse / data.totalRequests) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
