"use client";

import React from "react";
import type { AdminUser, AdminView } from "./admin.types";

interface AdminSidebarProps {
  currentView: AdminView;
  onSelectView: (view: AdminView) => void;
  adminUser: AdminUser;
  onSignOut: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

const NAV_ITEMS: { id: AdminView; label: string }[] = [
  { id: "overview", label: "Tổng quan" },
  { id: "users", label: "Người dùng" },
  { id: "ai-monitoring", label: "AI Monitoring" },
  { id: "notifications", label: "Thông báo" },
  { id: "audit-logs", label: "Audit Log" },
  { id: "system-settings", label: "Cấu hình" },
];

export default function AdminSidebar({
  currentView,
  onSelectView,
  adminUser,
  onSignOut,
  isOpenMobile = false,
  onCloseMobile,
}: AdminSidebarProps) {
  return (
    <>
      {isOpenMobile && (
        <div
          className="admin-sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`admin-sidebar ${isOpenMobile ? "mobile-open" : ""}`}
        aria-label="Admin Navigation"
      >
        <div className="admin-brand-area">
          <div className="admin-brand">
            <span className="brand-mark">
              <i />
              <i />
              <i />
            </span>
            <div className="admin-brand-text">
              <span className="brand-name">Sổ Chi Tiêu</span>
              <span className="admin-badge-label">ADMIN</span>
            </div>
          </div>
          {onCloseMobile && (
            <button
              type="button"
              className="admin-sidebar-close-btn"
              onClick={onCloseMobile}
              aria-label="Đóng menu"
            >
              Đóng
            </button>
          )}
        </div>

        <nav className="admin-nav" role="navigation">
          <span className="admin-nav-section-title">QUẢN TRỊ HỆ THỐNG</span>
          {NAV_ITEMS.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectView(item.id);
                  onCloseMobile?.();
                }}
                className={`admin-nav-item ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="admin-nav-indicator" />
                <span className="admin-nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-profile-info">
            <span className="admin-profile-name">{adminUser.name}</span>
            <span className="admin-profile-email">{adminUser.email}</span>
          </div>
          <button
            type="button"
            className="admin-btn-signout"
            onClick={onSignOut}
          >
            Đăng xuất
          </button>
        </div>
      </aside>
    </>
  );
}
