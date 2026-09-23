"use client";

import React, { useEffect, useState } from "react";
import AdminHeader from "../admin-header";
import AdminTable, { type Column } from "../components/admin-table";
import StatusBadge from "../components/status-badge";
import UserDetail from "./user-detail";
import type { ManagedUser } from "../admin.types";

interface UsersViewProps {
  getAuthToken: () => Promise<string | null>;
}

export default function UsersView({ getAuthToken }: UsersViewProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "user" | "admin">("all");
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function fetchUsers() {
      try {
        setLoading(true);
        setError(null);

        const token = await getAuthToken();
        if (!token) throw new Error("Chưa có phiên đăng nhập.");

        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
          status: statusFilter,
          role: roleFilter,
        });

        if (searchTerm.trim()) {
          params.set("search", searchTerm.trim());
        }

        const res = await fetch(`/api/admin/users?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Không thể tải danh sách người dùng.");
        }

        const json = await res.json();
        if (active) {
          setUsers(json.users || []);
          setTotal(json.total || 0);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchUsers();

    return () => {
      active = false;
    };
  }, [getAuthToken, page, limit, statusFilter, roleFilter, searchTerm, refreshKey]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setRefreshKey((k) => k + 1);
  };

  const columns: Column<ManagedUser>[] = [
    {
      key: "user_info",
      header: "Người dùng",
      render: (u) => (
        <div className="table-user-cell">
          <span className="user-email-text">{u.email}</span>
          <span className="user-name-text">
            {u.full_name || u.username || "Chưa đặt tên"}
          </span>
        </div>
      ),
    },
    {
      key: "role",
      header: "Vai trò",
      render: (u) => <StatusBadge variant={u.role} />,
      width: "120px",
    },
    {
      key: "status",
      header: "Trạng thái",
      render: (u) => <StatusBadge variant={u.status} />,
      width: "140px",
    },
    {
      key: "email_verified",
      header: "Xác thực email",
      render: (u) => (
        <StatusBadge
          variant={u.email_verified ? "success" : "neutral"}
          label={u.email_verified ? "Đã xác thực" : "Chưa"}
        />
      ),
      width: "150px",
    },
    {
      key: "created_at",
      header: "Ngày tạo",
      render: (u) => {
        try {
          return new Date(u.created_at).toLocaleDateString("vi-VN");
        } catch {
          return u.created_at;
        }
      },
      width: "130px",
    },
  ];

  return (
    <div className="admin-view-container">
      <AdminHeader
        title="Quản lý người dùng"
        subtitle="Tra cứu tài khoản, phân quyền vai trò và bảo vệ trạng thái an toàn."
      />

      {error && (
        <div className="admin-alert admin-alert-danger" role="alert">
          {error}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="admin-filter-bar">
        <form onSubmit={handleSearchSubmit} className="admin-search-form">
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo email hoặc tên..."
            className="admin-input admin-search-input"
          />
          <button type="submit" className="admin-btn admin-btn-primary">
            Tìm kiếm
          </button>
        </form>

        <div className="admin-filter-controls">
          <label className="admin-select-label">
            <span>Trạng thái:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as "all" | "active" | "suspended");
                setPage(1);
              }}
              className="admin-select"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="suspended">Tạm khóa</option>
            </select>
          </label>

          <label className="admin-select-label">
            <span>Vai trò:</span>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value as "all" | "user" | "admin");
                setPage(1);
              }}
              className="admin-select"
            >
              <option value="all">Tất cả vai trò</option>
              <option value="user">Người dùng (User)</option>
              <option value="admin">Quản trị viên (Admin)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Users Table */}
      <div className="admin-card no-padding">
        <AdminTable
          columns={columns}
          data={users}
          loading={loading}
          total={total}
          page={page}
          limit={limit}
          onPageChange={setPage}
          onRowClick={(u) => setSelectedUser(u)}
          rowKey={(u) => u.id}
          emptyTitle="Không tìm thấy người dùng"
          emptyMessage="Không có người dùng nào phù hợp với bộ lọc tìm kiếm hiện tại."
        />
      </div>

      {/* Selected User Detail Modal */}
      {selectedUser && (
        <UserDetail
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onUserUpdated={() => {
            setRefreshKey((k) => k + 1);
            setSelectedUser(null);
          }}
          getAuthToken={getAuthToken}
        />
      )}
    </div>
  );
}
