import { getSupabaseAdminClient } from "./admin-auth.service.ts";
import { getAiUsageStats } from "./admin-ai.service.ts";

export interface AdminOverviewMetrics {
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

export async function getAdminOverviewMetrics(): Promise<AdminOverviewMetrics> {
  const supabase = getSupabaseAdminClient();

  // 1. Fetch user counts from auth.admin
  const { data: authUsersData, error: authError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authError) {
    throw new Error(`Không thể lấy số liệu tài khoản: ${authError.message}`);
  }

  const users = authUsersData.users || [];
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(now.getDate() - 30);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(now.getDate() - 7);

  const totalUsers = authUsersData.total ?? users.length;
  const activeRecently = users.filter((u) => {
    if (!u.last_sign_in_at) return false;
    return new Date(u.last_sign_in_at) >= thirtyDaysAgo;
  }).length;
  const newThisWeek = users.filter((u) => new Date(u.created_at) >= sevenDaysAgo).length;

  // 2. Fetch AI stats for today
  const aiToday = await getAiUsageStats("today");

  // 3. System-wide aggregate/anonymized counts only (never personal financial details)
  const [txCountRes, walletsCountRes, budgetsCountRes] = await Promise.all([
    supabase.from("transactions").select("id", { count: "exact", head: true }),
    supabase.from("wallets").select("id", { count: "exact", head: true }),
    supabase.from("budgets").select("id", { count: "exact", head: true }),
  ]);

  // 4. Calculate 7-day signup series
  const signupSeriesMap = new Map<string, number>();
  for (let d = 6; d >= 0; d--) {
    const dt = new Date();
    dt.setDate(now.getDate() - d);
    const label = `${dt.getDate()}/${dt.getMonth() + 1}`;
    signupSeriesMap.set(label, 0);
  }

  users.forEach((u) => {
    const dt = new Date(u.created_at);
    const label = `${dt.getDate()}/${dt.getMonth() + 1}`;
    if (signupSeriesMap.has(label)) {
      signupSeriesMap.set(label, (signupSeriesMap.get(label) || 0) + 1);
    }
  });

  const userActivitySeries = Array.from(signupSeriesMap.entries()).map(([label, signups]) => ({
    label,
    signups,
  }));

  return {
    users: {
      total: totalUsers,
      activeRecently,
      newThisWeek,
    },
    ai: {
      todayRequests: aiToday.totalRequests,
      successRate: aiToday.successRate,
      todayErrors: aiToday.errorCount,
      featureBreakdown: aiToday.featureBreakdown,
    },
    system: {
      totalTransactionsCount: txCountRes.count ?? 0,
      activeWalletsCount: walletsCountRes.count ?? 0,
      activeBudgetsCount: budgetsCountRes.count ?? 0,
    },
    userActivitySeries,
  };
}
