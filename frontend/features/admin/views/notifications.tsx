"use client";

import React, { useState } from "react";
import AdminHeader from "../admin-header";
import ConfirmationDialog from "../components/confirmation-dialog";

interface NotificationsViewProps {
  getAuthToken: () => Promise<string | null>;
}

export default function NotificationsView({ getAuthToken }: NotificationsViewProps) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<"all">("all");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      setFeedback({
        type: "error",
        text: "Vui lòng nhập đầy đủ tiêu đề và nội dung thông báo.",
      });
      return;
    }
    setConfirmOpen(true);
  };

  const handleSend = async () => {
    try {
      setLoading(true);
      setFeedback(null);

      const token = await getAuthToken();
      if (!token) throw new Error("Chưa có phiên đăng nhập.");

      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          target,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Không thể phát thông báo.");
      }

      const json = await res.json();
      setConfirmOpen(false);
      setTitle("");
      setMessage("");
      setFeedback({
        type: "success",
        text: json.message || "Đã gửi thông báo thành công.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Đã có lỗi xảy ra.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-view-container">
      <AdminHeader
        title="Thông báo hệ thống"
        subtitle="Soạn thảo và phát thông báo trực tiếp đến người dùng ứng dụng."
      />

      {feedback && (
        <div
          className={`admin-alert ${
            feedback.type === "success"
              ? "admin-alert-success"
              : "admin-alert-danger"
          }`}
          role="alert"
        >
          {feedback.text}
        </div>
      )}

      <div className="admin-two-cols">
        {/* Broadcast Form */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Soạn thông báo mới</h2>
            <span className="admin-card-subtitle">
              Nội dung sẽ xuất hiện trong trung tâm thông báo của người dùng
            </span>
          </div>

          <form onSubmit={handleSubmit} className="admin-form">
            <label className="admin-form-group">
              <span className="admin-label">
                Tiêu đề thông báo
                <span className="char-count">({title.length}/200)</span>
              </span>
              <input
                type="text"
                value={title}
                maxLength={200}
                required
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ví dụ: Lịch bảo trì nâng cấp tính năng Trợ lý AI..."
                className="admin-input"
              />
            </label>

            <label className="admin-form-group">
              <span className="admin-label">
                Nội dung chi tiết
                <span className="char-count">({message.length}/2000)</span>
              </span>
              <textarea
                value={message}
                maxLength={2000}
                required
                rows={6}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Nhập nội dung cần truyền đạt đến người dùng (HTML sẽ được tự động lọc bỏ)..."
                className="admin-textarea"
              />
            </label>

            <label className="admin-form-group">
              <span className="admin-label">Đối tượng nhận</span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as "all")}
                className="admin-select"
              >
                <option value="all">Tất cả người dùng (Toàn hệ thống)</option>
              </select>
            </label>

            <div className="admin-form-actions">
              <button
                type="submit"
                disabled={loading || !title.trim() || !message.trim()}
                className="admin-btn admin-btn-primary"
              >
                Phát thông báo
              </button>
            </div>
          </form>
        </div>

        {/* Live Preview Card */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Xem trước hiển thị</h2>
            <span className="admin-card-subtitle">
              Mô phỏng thông báo mà người dùng sẽ nhận được
            </span>
          </div>

          <div className="notification-preview-box">
            <div className="preview-badge">Hệ thống</div>
            <h3 className="preview-title">
              {title.trim() || "Tiêu đề thông báo"}
            </h3>
            <p className="preview-body">
              {message.trim() ||
                "Nội dung thông báo sẽ hiển thị tại đây khi bạn nhập vào biểu mẫu bên trái."}
            </p>
            <span className="preview-time">Vừa xong</span>
          </div>

          <div className="preview-hint">
            Hệ thống tự động loại bỏ thẻ script, style hoặc các mã độc hại để đảm bảo tính an toàn cho người dùng nhận tin.
          </div>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={confirmOpen}
        title="Xác nhận phát thông báo toàn hệ thống"
        description={`Bạn có chắc chắn muốn phát thông báo "${title}" tới tất cả người dùng trong hệ thống? Hành động này sẽ được ghi vào nhật ký kiểm toán.`}
        confirmLabel="Phát thông báo"
        cancelLabel="Kiểm tra lại"
        isDangerous={false}
        loading={loading}
        onConfirm={handleSend}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
