"use client";

import React, { useState } from "react";
import AdminSidebar from "./admin-sidebar";
import type { AdminUser, AdminView } from "./admin.types";

interface AdminLayoutProps {
  currentView: AdminView;
  onSelectView: (view: AdminView) => void;
  adminUser: AdminUser;
  onSignOut: () => void;
  children: React.ReactNode;
}

export default function AdminLayout({
  currentView,
  onSelectView,
  adminUser,
  onSignOut,
  children,
}: AdminLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="admin-shell">
      <AdminSidebar
        currentView={currentView}
        onSelectView={onSelectView}
        adminUser={adminUser}
        onSignOut={onSignOut}
        isOpenMobile={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="admin-main-wrapper">
        <div className="admin-mobile-topbar">
          <div className="admin-brand">
            <span className="brand-mark">
              <i />
              <i />
              <i />
            </span>
            <span className="brand-name">Sổ Chi Tiêu ADMIN</span>
          </div>
          <button
            type="button"
            className="admin-mobile-menu-toggle"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Mở menu quản trị"
          >
            Menu
          </button>
        </div>

        <main className="admin-main-content" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}
