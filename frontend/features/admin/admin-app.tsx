"use client";

import React, { useCallback, useState } from "react";
import { createClient } from "@/config/supabase";
import AdminLayout from "./admin-layout";
import OverviewView from "./views/overview";
import UsersView from "./views/users";
import AiMonitoringView from "./views/ai-monitoring";
import NotificationsView from "./views/notifications";
import AuditLogsView from "./views/audit-logs";
import SystemSettingsView from "./views/system-settings";
import type { AdminUser, AdminView } from "./admin.types";

interface AdminAppProps {
  user: AdminUser;
  onSignOut: () => void;
}

export default function AdminApp({ user, onSignOut }: AdminAppProps) {
  const [currentView, setCurrentView] = useState<AdminView>("overview");

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  const renderCurrentView = () => {
    switch (currentView) {
      case "overview":
        return <OverviewView getAuthToken={getAuthToken} />;
      case "users":
        return <UsersView getAuthToken={getAuthToken} />;
      case "ai-monitoring":
        return <AiMonitoringView getAuthToken={getAuthToken} />;
      case "notifications":
        return <NotificationsView getAuthToken={getAuthToken} />;
      case "audit-logs":
        return <AuditLogsView getAuthToken={getAuthToken} />;
      case "system-settings":
        return <SystemSettingsView getAuthToken={getAuthToken} />;
      default:
        return <OverviewView getAuthToken={getAuthToken} />;
    }
  };

  return (
    <AdminLayout
      currentView={currentView}
      onSelectView={setCurrentView}
      adminUser={user}
      onSignOut={onSignOut}
    >
      {renderCurrentView()}
    </AdminLayout>
  );
}
