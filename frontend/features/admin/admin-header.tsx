"use client";

import React from "react";

interface AdminHeaderProps {
  title: string;
  subtitle: string;
  onToggleMobileNav?: () => void;
  actions?: React.ReactNode;
}

export default function AdminHeader({
  title,
  subtitle,
  onToggleMobileNav,
  actions,
}: AdminHeaderProps) {
  return (
    <header className="admin-header">
      <div className="admin-header-main">
        {onToggleMobileNav && (
          <button
            type="button"
            className="admin-mobile-nav-btn"
            onClick={onToggleMobileNav}
            aria-label="Mở menu quản trị"
          >
            Menu
          </button>
        )}
        <div className="admin-header-titles">
          <h1 className="admin-header-title">{title}</h1>
          <p className="admin-header-subtitle">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="admin-header-actions">{actions}</div>}
    </header>
  );
}
