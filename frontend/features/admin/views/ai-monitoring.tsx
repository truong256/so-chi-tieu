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
