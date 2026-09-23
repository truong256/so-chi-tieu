"use client";

import React, { useState } from "react";
import StatusBadge from "../components/status-badge";
import ConfirmationDialog from "../components/confirmation-dialog";
import type { ManagedUser } from "../admin.types";

interface UserDetailProps {
  user: ManagedUser;
  onClose: () => void;
  onUserUpdated: () => void;
  getAuthToken: () => Promise<string | null>;
}

export default function UserDetail({
  user,
  onClose,
  onUserUpdated,
  getAuthToken,
}: UserDetailProps) {
  const [confirmSuspendOpen, setConfirmSuspendOpen] = useState(false);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
    resetLink?: string;
  } | null>(null);

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return "Chưa có dữ liệu";
    try {
      const dt = new Date(isoString);
      return `${dt.toLocaleDateString("vi-VN")} ${dt.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    } catch {
      return isoString;
    }
  };

  const handleSuspend = async () => {
    try {
      setActionLoading(true);
      setActionMessage(null);
      const token = await getAuthToken();
      if (!token) throw new Error("Chưa có phiên đăng nhập.");

      const res = await fetch(`/api/admin/users/${user.id}/suspend`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "Tạm khóa bởi quản trị viên" }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Không thể khóa tài khoản.");
      }

      setConfirmSuspendOpen(false);
      setActionMessage({
        type: "success",
        text: "Tài khoản đã được tạm khóa thành công.",
      });
      onUserUpdated();
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Đã có lỗi xảy ra.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async () => {
    try {
      setActionLoading(true);
      setActionMessage(null);
      const token = await getAuthToken();
      if (!token) throw new Error("Chưa có phiên đăng nhập.");

      const res = await fetch(`/api/admin/users/${user.id}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Không thể mở khóa tài khoản.");
      }

      setConfirmRestoreOpen(false);
      setActionMessage({
        type: "success",
        text: "Tài khoản đã được mở khóa và kích hoạt lại.",
      });
      onUserUpdated();
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Đã có lỗi xảy ra.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendPasswordReset = async () => {
    try {
      setActionLoading(true);
      setActionMessage(null);
      const token = await getAuthToken();
      if (!token) throw new Error("Chưa có phiên đăng nhập.");

      const res = await fetch(`/api/admin/users/${user.id}/send-password-reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Không thể tạo liên kết đặt lại mật khẩu.");
      }

      const json = await res.json();
      setConfirmResetOpen(false);
      setActionMessage({
        type: "success",
        text: "Đã tạo liên kết đặt lại mật khẩu thành công.",
        resetLink: json.resetLink,
      });
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Đã có lỗi xảy ra.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div
        className="admin-modal-card user-detail-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-header">
          <div>
            <span className="admin-section-eyebrow">CHI TIẾT TÀI KHOẢN</span>
            <h2 id="user-detail-title" className="admin-modal-title">
              {user.full_name || "Chưa đặt tên"}
            </h2>
          </div>
          <button
            type="button"
            className="admin-btn-close"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
          >
            Đóng
          </button>
        </div>

        {actionMessage && (
          <div
            className={`admin-alert ${
              actionMessage.type === "success"
                ? "admin-alert-success"
                : "admin-alert-danger"
            }`}
          >
            <p>{actionMessage.text}</p>
            {actionMessage.resetLink && (
              <div className="admin-reset-link-box">
                <span className="reset-link-label">Liên kết khôi phục trực tiếp:</span>
                <input
                  type="text"
                  readOnly
                  value={actionMessage.resetLink}
                  className="admin-input reset-link-input"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </div>
            )}
          </div>
        )}

        <div className="user-detail-grid">
          <div className="detail-item">
            <span className="detail-label">Email tài khoản</span>
            <span className="detail-value">{user.email}</span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Tên hiển thị</span>
            <span className="detail-value">{user.full_name || "Chưa cập nhật"}</span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Tên người dùng (Username)</span>
            <span className="detail-value">
              {user.username ? `@${user.username}` : "Chưa thiết lập"}
            </span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Vai trò hệ thống</span>
            <div className="detail-value-badge">
              <StatusBadge variant={user.role} />
            </div>
          </div>

          <div className="detail-item">
            <span className="detail-label">Trạng thái tài khoản</span>
            <div className="detail-value-badge">
              <StatusBadge variant={user.status} />
            </div>
          </div>

          <div className="detail-item">
            <span className="detail-label">Xác thực Email</span>
            <div className="detail-value-badge">
              <StatusBadge
                variant={user.email_verified ? "success" : "neutral"}
                label={user.email_verified ? "Đã xác thực" : "Chưa xác thực"}
              />
            </div>
          </div>

          <div className="detail-item">
            <span className="detail-label">Ngày tạo tài khoản</span>
            <span className="detail-value">{formatDate(user.created_at)}</span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Đăng nhập gần nhất</span>
            <span className="detail-value">{formatDate(user.last_sign_in_at)}</span>
          </div>
        </div>

        <div className="user-detail-security-notice">
          Lưu ý bảo mật: Quản trị viên không thể xem hoặc can thiệp trực tiếp vào mật khẩu người dùng. Mật khẩu được mã hóa an toàn ở tầng hạ tầng Supabase Auth.
        </div>

        <div className="user-detail-actions">
          {user.status === "active" ? (
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() => setConfirmSuspendOpen(true)}
              disabled={actionLoading || user.role === "admin"}
            >
              Khóa tài khoản
            </button>
          ) : (
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={() => setConfirmRestoreOpen(true)}
              disabled={actionLoading}
            >
              Mở khóa tài khoản
            </button>
          )}

          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => setConfirmResetOpen(true)}
            disabled={actionLoading}
          >
            Gửi liên kết đổi mật khẩu
          </button>

          <button
            type="button"
            className="admin-btn admin-btn-ghost"
            onClick={onClose}
          >
            Đóng
          </button>
        </div>

        {/* Confirmation Dialogs */}
        <ConfirmationDialog
          isOpen={confirmSuspendOpen}
          title="Xác nhận khóa tài khoản"
          description={`Bạn có chắc chắn muốn tạm khóa tài khoản ${user.email}? Người dùng này sẽ không thể đăng nhập vào ứng dụng cho đến khi được mở khóa.`}
          confirmLabel="Khóa tài khoản"
          cancelLabel="Hủy"
          isDangerous={true}
          loading={actionLoading}
          onConfirm={handleSuspend}
          onCancel={() => setConfirmSuspendOpen(false)}
        />

        <ConfirmationDialog
          isOpen={confirmRestoreOpen}
          title="Xác nhận mở khóa tài khoản"
          description={`Kích hoạt lại quyền truy cập cho tài khoản ${user.email}. Người dùng sẽ có thể đăng nhập lại bình thường.`}
          confirmLabel="Mở khóa"
          cancelLabel="Hủy"
          isDangerous={false}
          loading={actionLoading}
          onConfirm={handleRestore}
          onCancel={() => setConfirmRestoreOpen(false)}
        />

        <ConfirmationDialog
          isOpen={confirmResetOpen}
          title="Gửi liên kết đổi mật khẩu"
          description={`Tạo liên kết khôi phục mật khẩu cho tài khoản ${user.email}.`}
          confirmLabel="Tạo liên kết"
          cancelLabel="Hủy"
          isDangerous={false}
          loading={actionLoading}
          onConfirm={handleSendPasswordReset}
          onCancel={() => setConfirmResetOpen(false)}
        />
      </div>
    </div>
  );
}
