export type AdminView =
  | "overview"
  | "users"
  | "ai-monitoring"
  | "notifications"
  | "audit-logs"
  | "system-settings";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
}

export interface ManagedUser {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  email_verified: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  updated_at?: string;
  banned_until?: string | null;
}

export interface AdminOverviewData {
  users: {
    total: number;
    activeRecently: number;
    newThisWeek: number;
  };
  ai: {
    todayRequests: number;
    successRate: number;
    todayErrors: number;
    featureBreakdown: {
      chat: number;
      parseTransaction: number;
      receiptParse: number;
    };
  };
  system: {
    totalTransactionsCount: number;
    activeWalletsCount: number;
    activeBudgetsCount: number;
  };
  userActivitySeries: {
    label: string;
    signups: number;
  }[];
}

export interface AiMonitoringData {
  period: "today" | "7d" | "30d";
  totalRequests: number;
  successRate: number;
  errorCount: number;
  avgLatencyMs: number;
  featureBreakdown: {
    chat: number;
    parseTransaction: number;
    receiptParse: number;
  };
  timeSeries: {
    label: string;
    total: number;
    errors: number;
  }[];
}

export interface AuditLogItem {
  id: string;
  admin_id: string | null;
  admin_name?: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SystemSettingsData {
  ai_enabled?: boolean;
  receipt_scan_enabled?: boolean;
  maintenance_mode?: boolean;
  [key: string]: unknown;
}
