"use client";

import React, { useEffect, useState } from "react";
import AdminHeader from "../admin-header";
import AdminStatCard from "../components/admin-stat-card";
import type { AdminOverviewData } from "../admin.types";

interface OverviewViewProps {
  getAuthToken: () => Promise<string | null>;
}

export default function OverviewView({ getAuthToken }: OverviewViewProps) {
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchOverview() {
      try {
        setLoading(true);
        setError(null);

        const token = await getAuthToken();
        if (!token) throw new Error("Chưa có phiên đăng nhập.");

        const res = await fetch("/api/admin/overview", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Không thể tải dữ liệu tổng quan.");
        }

        const json = (await res.json()) as AdminOverviewData;
        if (active) setData(json);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchOverview();

    return () => {
      active = false;
    };
  }, [getAuthToken]);

  return (
    <div className="admin-view-container">
      <AdminHeader
        title="Tổng quan hệ thống"
        subtitle="Theo dõi người dùng, hoạt động dịch vụ và tài nguyên AI."
      />

      {error && (
        <div className="admin-alert admin-alert-danger" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="admin-loading-placeholder">
          <div className="admin-spinner" />
          <span>Đang tải thông số hệ thống...</span>
        </div>
      ) : data ? (
        <>
          {/* Key Stat Cards Grid */}
          <div className="admin-stats-grid">
            <AdminStatCard
              label="Tổng người dùng"
              value={data.users.total.toLocaleString("vi-VN")}
              sublabel={`${data.users.newThisWeek} tài khoản mới tuần này`}
            />
            <AdminStatCard
              label="Hoạt động gần đây"
              value={data.users.activeRecently.toLocaleString("vi-VN")}
              sublabel="Đã đăng nhập trong 30 ngày qua"
              trend={{
                text: `${
                  data.users.total > 0
                    ? Math.round(
                        (data.users.activeRecently / data.users.total) * 100,
                      )
                    : 0
                }% tổng số`,
                isPositive: true,
              }}
            />
            <AdminStatCard
              label="Yêu cầu AI hôm nay"
              value={data.ai.todayRequests.toLocaleString("vi-VN")}
              sublabel={`Tỉ lệ thành công ${data.ai.successRate}%`}
              variant="highlight"
            />
            <AdminStatCard
              label="Lỗi AI hôm nay"
              value={data.ai.todayErrors.toLocaleString("vi-VN")}
              sublabel="Cần chú ý nếu tăng bất thường"
              variant={data.ai.todayErrors > 10 ? "dark" : "default"}
              trend={{
                text: `${data.ai.todayErrors} lỗi`,
                isPositive: data.ai.todayErrors === 0,
              }}
            />
          </div>

          {/* User Signups Activity Chart */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Hoạt động đăng ký người dùng mới (7 ngày)</h2>
              <span className="admin-card-subtitle">
                Số lượng tài khoản đăng ký theo từng ngày
              </span>
            </div>
            <div className="admin-chart-container">
              <div className="admin-bar-chart">
                {data.userActivitySeries.map((item, idx) => {
                  const maxVal = Math.max(
                    1,
                    ...data.userActivitySeries.map((s) => s.signups),
                  );
                  const heightPercent = Math.max(
                    8,
                    Math.round((item.signups / maxVal) * 100),
                  );
                  return (
                    <div key={idx} className="chart-bar-group">
                      <div className="chart-bar-wrap">
                        <div
                          className="chart-bar"
                          style={{ height: `${heightPercent}%` }}
                          title={`${item.label}: ${item.signups} tài khoản`}
                        />
                      </div>
                      <span className="chart-bar-value">{item.signups}</span>
                      <span className="chart-bar-label">{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* AI Usage Breakdown & System Anonymized Stats */}
          <div className="admin-two-cols">
            <div className="admin-card">
              <div className="admin-card-header">
                <h2 className="admin-card-title">Phân bổ tính năng AI (Hôm nay)</h2>
                <span className="admin-card-subtitle">
                  Số lượt gọi theo từng dịch vụ
                </span>
              </div>
              <div className="admin-breakdown-list">
                <div className="breakdown-item">
                  <div className="breakdown-header">
                    <span className="breakdown-name">Trợ lý tài chính (Chat)</span>
                    <span className="breakdown-count">
                      {data.ai.featureBreakdown.chat} lượt
                    </span>
                  </div>
                  <div className="breakdown-track">
                    <div
                      className="breakdown-fill fill-primary"
                      style={{
                        width: `${
                          data.ai.todayRequests > 0
                            ? (data.ai.featureBreakdown.chat /
                                data.ai.todayRequests) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div className="breakdown-item">
                  <div className="breakdown-header">
                    <span className="breakdown-name">Phân tích giao dịch tự động</span>
                    <span className="breakdown-count">
                      {data.ai.featureBreakdown.parseTransaction} lượt
                    </span>
                  </div>
                  <div className="breakdown-track">
                    <div
                      className="breakdown-fill fill-accent"
                      style={{
                        width: `${
                          data.ai.todayRequests > 0
                            ? (data.ai.featureBreakdown.parseTransaction /
                                data.ai.todayRequests) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div className="breakdown-item">
                  <div className="breakdown-header">
                    <span className="breakdown-name">Quét & trích xuất hóa đơn</span>
                    <span className="breakdown-count">
                      {data.ai.featureBreakdown.receiptParse} lượt
                    </span>
                  </div>
                  <div className="breakdown-track">
                    <div
                      className="breakdown-fill fill-neutral"
                      style={{
                        width: `${
                          data.ai.todayRequests > 0
                            ? (data.ai.featureBreakdown.receiptParse /
                                data.ai.todayRequests) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="admin-card">
              <div className="admin-card-header">
                <h2 className="admin-card-title">Chỉ số quy mô hệ thống</h2>
                <span className="admin-card-subtitle">
                  Dữ liệu tổng hợp ẩn danh (không chứa thông tin cá nhân)
                </span>
              </div>
              <div className="admin-meta-list">
                <div className="meta-row">
                  <span className="meta-label">Tổng giao dịch trên toàn hệ thống</span>
                  <span className="meta-value">
                    {data.system.totalTransactionsCount.toLocaleString("vi-VN")}
                  </span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">Tổng số ví đang hoạt động</span>
                  <span className="meta-value">
                    {data.system.activeWalletsCount.toLocaleString("vi-VN")}
                  </span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">Tổng kế hoạch ngân sách thiết lập</span>
                  <span className="meta-value">
                    {data.system.activeBudgetsCount.toLocaleString("vi-VN")}
                  </span>
                </div>
                <div className="meta-notice">
                  Quyền riêng tư: Quản trị viên chỉ xem số lượng tổng hợp, không có quyền truy cập số dư hoặc chi tiết giao dịch của từng người dùng.
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
