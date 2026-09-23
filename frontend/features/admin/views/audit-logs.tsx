"use client";

import React, { useEffect, useState } from "react";
import AdminHeader from "../admin-header";
import AdminTable, { type Column } from "../components/admin-table";
import StatusBadge from "../components/status-badge";
import type { AuditLogItem } from "../admin.types";

interface AuditLogsViewProps {
  getAuthToken: () => Promise<string | null>;
}

export default function AuditLogsView({ getAuthToken }: AuditLogsViewProps) {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [actionFilter, setActionFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function fetchAuditLogs() {
      try {
        setLoading(true);
        setError(null);

        const token = await getAuthToken();
        if (!token) throw new Error("Chưa có phiên đăng nhập.");

        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
          action: actionFilter,
        });

        if (searchTerm.trim()) {
          params.set("search", searchTerm.trim());
        }

        const res = await fetch(`/api/admin/audit?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Không thể tải nhật ký kiểm toán.");
        }

        const json = await res.json();
        if (active) {
          setLogs(json.logs || []);
          setTotal(json.total || 0);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchAuditLogs();

    return () => {
      active = false;
    };
  }, [getAuthToken, page, limit, actionFilter, searchTerm, refreshKey]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setRefreshKey((k) => k + 1);
  };

  const getActionBadgeVariant = (action: string) => {
    switch (action) {
      case "USER_SUSPENDED":
        return "suspended";
      case "USER_RESTORED":
        return "active";
      case "PASSWORD_RESET_SENT":
        return "neutral";
      case "SYSTEM_SETTING_UPDATED":
        return "admin";
      case "SYSTEM_NOTIFICATION_SENT":
        return "active";
      default:
        return "neutral";
    }
  };

  const getActionText = (action: string) => {
    switch (action) {
      case "USER_SUSPENDED":
        return "Khóa tài khoản";
      case "USER_RESTORED":
        return "Mở khóa tài khoản";
      case "PASSWORD_RESET_SENT":
        return "Gửi đặt lại mật khẩu";
      case "SYSTEM_SETTING_UPDATED":
        return "Cập nhật cấu hình";
      case "SYSTEM_NOTIFICATION_SENT":
        return "Phát thông báo hệ thống";
      case "ROLE_CHANGED":
        return "Đổi vai trò tài khoản";
      default:
        return action;
    }
  };

  const columns: Column<AuditLogItem>[] = [
    {
      key: "created_at",
      header: "Thời gian",
      render: (log) => {
        try {
          const dt = new Date(log.created_at);
          return (
            <span className="audit-time-cell">
              {dt.toLocaleDateString("vi-VN")}{" "}
              {dt.toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          );
        } catch {
          return log.created_at;
        }
      },
      width: "170px",
    },
    {
      key: "admin_name",
      header: "Quản trị viên",
      render: (log) => (
        <span className="audit-admin-text">
          {log.admin_name || log.admin_id || "Hệ thống"}
        </span>
      ),
      width: "150px",
    },
    {
      key: "action",
      header: "Hành động",
      render: (log) => (
        <StatusBadge
          variant={getActionBadgeVariant(log.action)}
          label={getActionText(log.action)}
        />
      ),
      width: "200px",
    },
    {
      key: "target",
      header: "Đối tượng tác động",
      render: (log) => (
        <div className="audit-target-cell">
          <span className="target-type">{log.target_type}</span>
          {log.target_id && (
            <span className="target-id" title={log.target_id}>
              {log.target_id.slice(0, 16)}...
            </span>
          )}
        </div>
      ),
      width: "200px",
    },
    {
      key: "metadata",
      header: "Chi tiết",
      render: (log) => {
        const metaStr = Object.keys(log.metadata || {}).length > 0
          ? JSON.stringify(log.metadata)
          : "-";
        return <span className="audit-meta-text">{metaStr}</span>;
      },
    },
  ];

  return (
    <div className="admin-view-container">
      <AdminHeader
        title="Audit Log (Nhật ký kiểm toán)"
        subtitle="Lịch sử các thao tác quản trị nhằm đảm bảo tính minh bạch và an toàn hệ thống."
      />

      {error && (
        <div className="admin-alert admin-alert-danger" role="alert">
          {error}
        </div>
      )}

      {/* Filter and Search */}
      <div className="admin-filter-bar">
        <form onSubmit={handleSearchSubmit} className="admin-search-form">
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo hành động hoặc đối tượng..."
            className="admin-input admin-search-input"
          />
          <button type="submit" className="admin-btn admin-btn-primary">
            Tìm kiếm
          </button>
        </form>

        <div className="admin-filter-controls">
          <label className="admin-select-label">
            <span>Loại hành động:</span>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="admin-select"
            >
              <option value="all">Tất cả hành động</option>
              <option value="USER_SUSPENDED">Khóa tài khoản</option>
              <option value="USER_RESTORED">Mở khóa tài khoản</option>
              <option value="PASSWORD_RESET_SENT">Đặt lại mật khẩu</option>
              <option value="SYSTEM_SETTING_UPDATED">Cập nhật cấu hình</option>
              <option value="SYSTEM_NOTIFICATION_SENT">Phát thông báo</option>
            </select>
          </label>
        </div>
      </div>

      <div className="admin-card no-padding">
        <AdminTable
          columns={columns}
          data={logs}
          loading={loading}
          total={total}
          page={page}
          limit={limit}
          onPageChange={setPage}
          rowKey={(l) => l.id}
          emptyTitle="Chưa có nhật ký kiểm toán"
          emptyMessage="Các thao tác quản trị viên thực hiện sẽ tự động được ghi nhận tại đây."
        />
      </div>
    </div>
  );
}
