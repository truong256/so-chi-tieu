"use client";

import React, { useEffect, useState } from "react";
import AdminHeader from "../admin-header";
import type { SystemSettingsData } from "../admin.types";

interface SystemSettingsViewProps {
  getAuthToken: () => Promise<string | null>;
}

export default function SystemSettingsView({ getAuthToken }: SystemSettingsViewProps) {
  const [settings, setSettings] = useState<SystemSettingsData>({
    ai_enabled: true,
    receipt_scan_enabled: true,
    maintenance_mode: false,
  });

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchSettings() {
      try {
        setLoading(true);
        setFeedback(null);

        const token = await getAuthToken();
        if (!token) throw new Error("Chưa có phiên đăng nhập.");

        const res = await fetch("/api/admin/settings", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Không thể tải cấu hình hệ thống.");
        }

        const json = await res.json();
        if (active) setSettings((prev) => ({ ...prev, ...json }));
      } catch (err) {
        if (active) {
          setFeedback({
            type: "error",
            text: err instanceof Error ? err.message : "Đã có lỗi xảy ra.",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchSettings();

    return () => {
      active = false;
    };
  }, [getAuthToken]);

  const handleToggle = async (key: string, currentValue: boolean) => {
    const nextValue = !currentValue;
    try {
      setSavingKey(key);
      setFeedback(null);

      const token = await getAuthToken();
      if (!token) throw new Error("Chưa có phiên đăng nhập.");

      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key, value: nextValue }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Không thể cập nhật cấu hình.");
      }

      setSettings((prev) => ({ ...prev, [key]: nextValue }));
      setFeedback({
        type: "success",
        text: `Đã lưu thay đổi cho cài đặt "${key}" thành công.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Đã có lỗi xảy ra.",
      });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="admin-view-container">
      <AdminHeader
        title="Cấu hình hệ thống"
        subtitle="Quản lý công tắc tính năng vận hành toàn cục và trạng thái dịch vụ."
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

      {loading ? (
        <div className="admin-loading-placeholder">
          <div className="admin-spinner" />
          <span>Đang tải cấu hình hệ thống...</span>
        </div>
      ) : (
        <div className="admin-two-cols">
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Công tắc tính năng (Feature Flags)</h2>
              <span className="admin-card-subtitle">
                Bật hoặc tắt tính năng ngay lập tức trên toàn hệ thống
              </span>
            </div>

            <div className="settings-list">
              <div className="setting-item">
                <div className="setting-info">
                  <span className="setting-name">Trợ lý AI & Phân tích thông minh</span>
                  <p className="setting-description">
                    Cho phép người dùng sử dụng Trợ lý hội thoại và tự động phân tích giao dịch bằng ngôn ngữ tự nhiên.
                  </p>
                </div>
                <button
                  type="button"
                  className={`admin-toggle-switch ${
                    settings.ai_enabled ? "active" : ""
                  }`}
                  disabled={savingKey === "ai_enabled"}
                  onClick={() =>
                    handleToggle("ai_enabled", Boolean(settings.ai_enabled))
                  }
                  aria-pressed={Boolean(settings.ai_enabled)}
                >
                  <span className="toggle-slider" />
                  <span className="toggle-label">
                    {settings.ai_enabled ? "Bật" : "Tắt"}
                  </span>
                </button>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <span className="setting-name">Quét & trích xuất hóa đơn (OCR)</span>
                  <p className="setting-description">
                    Cho phép người dùng tải ảnh hóa đơn để trích xuất thông tin thanh toán tự động.
                  </p>
                </div>
                <button
                  type="button"
                  className={`admin-toggle-switch ${
                    settings.receipt_scan_enabled ? "active" : ""
                  }`}
                  disabled={savingKey === "receipt_scan_enabled"}
                  onClick={() =>
                    handleToggle(
                      "receipt_scan_enabled",
                      Boolean(settings.receipt_scan_enabled),
                    )
                  }
                  aria-pressed={Boolean(settings.receipt_scan_enabled)}
                >
                  <span className="toggle-slider" />
                  <span className="toggle-label">
                    {settings.receipt_scan_enabled ? "Bật" : "Tắt"}
                  </span>
                </button>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <span className="setting-name">Chế độ bảo trì toàn hệ thống</span>
                  <p className="setting-description">
                    Khi kích hoạt, người dùng thông thường sẽ nhận được thông báo hệ thống đang bảo trì.
                  </p>
                </div>
                <button
                  type="button"
                  className={`admin-toggle-switch ${
                    settings.maintenance_mode ? "active" : ""
                  }`}
                  disabled={savingKey === "maintenance_mode"}
                  onClick={() =>
                    handleToggle(
                      "maintenance_mode",
                      Boolean(settings.maintenance_mode),
                    )
                  }
                  aria-pressed={Boolean(settings.maintenance_mode)}
                >
                  <span className="toggle-slider" />
                  <span className="toggle-label">
                    {settings.maintenance_mode ? "Bật" : "Tắt"}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Nguyên tắc bảo mật cấu hình</h2>
              <span className="admin-card-subtitle">
                Kiến trúc an toàn dành cho quản trị viên
              </span>
            </div>

            <div className="security-guide-box">
              <div className="guide-bullet">
                <strong>1. Bảo vệ khóa bí mật (Secrets):</strong>
                <p>
                  Các khóa như Gemini API và khóa dịch vụ máy chủ được lưu trữ nghiêm ngặt trong biến môi trường máy chủ (.env.local hoặc Worker Secret). Không thể xem hoặc thay đổi chúng qua giao diện để tránh rò rỉ.
                </p>
              </div>

              <div className="guide-bullet">
                <strong>2. Phân tách quyền hạn:</strong>
                <p>
                  Mọi thao tác thay đổi cài đặt đều được xác thực hai lớp (kiểm tra vai trò Admin tại backend và cơ sở dữ liệu) và tự động ghi vào Audit Log.
                </p>
              </div>

              <div className="guide-bullet">
                <strong>3. Tính toàn vẹn dữ liệu:</strong>
                <p>
                  Cài đặt hệ thống chỉ tác động lên cờ tính năng, không thay đổi hay xóa bỏ dữ liệu tài chính của người dùng.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
