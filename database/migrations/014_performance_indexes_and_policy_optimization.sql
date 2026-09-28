-- Migration 014: Performance Indexes and RLS Policy Optimization
-- Resolves Supabase Performance Advisor warnings:
-- 1. Adds missing foreign key indexes.
-- 2. Drops duplicate indexes.
-- 3. Consolidates multiple permissive policies into single clean policies.
-- 4. Optimizes auth.uid() to (select auth.uid()) for query planner InitPlan caching.

-- ─── 1. MISSING FOREIGN KEY INDEXES ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS fund_allocations_budget_id_idx
  ON public.fund_allocations (budget_id) WHERE budget_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fund_allocations_goal_id_idx
  ON public.fund_allocations (goal_id) WHERE goal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fund_allocations_wallet_id_idx
  ON public.fund_allocations (wallet_id) WHERE wallet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS recurring_occurrences_transaction_id_idx
  ON public.recurring_occurrences (transaction_id) WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS savings_goals_source_wallet_id_idx
  ON public.savings_goals (source_wallet_id) WHERE source_wallet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_goal_id_idx
  ON public.transactions (goal_id) WHERE goal_id IS NOT NULL;

-- ─── 2. DROP DUPLICATE INDEXES ────────────────────────────────────────────────
-- Keep standard transactions_user_id_occurred_at_idx and transfers_user_id_occurred_at_idx
DROP INDEX IF EXISTS public.transactions_user_occurred_idx;
DROP INDEX IF EXISTS public.transfers_user_occurred_idx;

-- ─── 3. CONSOLIDATE POLICIES & OPTIMIZE WITH (SELECT auth.uid()) ──────────────

-- WALLETS
DROP POLICY IF EXISTS "Wallets are viewable by owner" ON public.wallets;
DROP POLICY IF EXISTS "Wallets can be inserted by owner" ON public.wallets;
DROP POLICY IF EXISTS "Wallets can be updated by owner" ON public.wallets;
DROP POLICY IF EXISTS "Wallets can be deleted by owner" ON public.wallets;
DROP POLICY IF EXISTS "Users can manage own wallets" ON public.wallets;

CREATE POLICY "Users can manage own wallets" ON public.wallets
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- CATEGORIES
DROP POLICY IF EXISTS "Categories are viewable by owner" ON public.categories;
DROP POLICY IF EXISTS "Categories can be inserted by owner" ON public.categories;
DROP POLICY IF EXISTS "Categories can be updated by owner" ON public.categories;
DROP POLICY IF EXISTS "Categories can be deleted by owner" ON public.categories;
DROP POLICY IF EXISTS "Users can manage own categories" ON public.categories;

CREATE POLICY "Users can manage own categories" ON public.categories
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- TRANSACTIONS
DROP POLICY IF EXISTS "Transactions are viewable by owner" ON public.transactions;
DROP POLICY IF EXISTS "Transactions can be inserted by owner" ON public.transactions;
DROP POLICY IF EXISTS "Transactions can be updated by owner" ON public.transactions;
DROP POLICY IF EXISTS "Transactions can be deleted by owner" ON public.transactions;
DROP POLICY IF EXISTS "Users can manage own transactions" ON public.transactions;

CREATE POLICY "Users can manage own transactions" ON public.transactions
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- TRANSFERS
DROP POLICY IF EXISTS "Transfers are viewable by owner" ON public.transfers;
DROP POLICY IF EXISTS "Transfers can be inserted by owner" ON public.transfers;
DROP POLICY IF EXISTS "Transfers can be updated by owner" ON public.transfers;
DROP POLICY IF EXISTS "Transfers can be deleted by owner" ON public.transfers;
DROP POLICY IF EXISTS "Users can manage own transfers" ON public.transfers;

CREATE POLICY "Users can manage own transfers" ON public.transfers
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- BUDGETS
DROP POLICY IF EXISTS "Budgets are viewable by owner" ON public.budgets;
DROP POLICY IF EXISTS "Budgets can be inserted by owner" ON public.budgets;
DROP POLICY IF EXISTS "Budgets can be updated by owner" ON public.budgets;
DROP POLICY IF EXISTS "Budgets can be deleted by owner" ON public.budgets;
DROP POLICY IF EXISTS "Users can manage own budgets" ON public.budgets;

CREATE POLICY "Users can manage own budgets" ON public.budgets
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- SAVINGS GOALS
DROP POLICY IF EXISTS "Savings goals are viewable by owner" ON public.savings_goals;
DROP POLICY IF EXISTS "Savings goals can be inserted by owner" ON public.savings_goals;
DROP POLICY IF EXISTS "Savings goals can be updated by owner" ON public.savings_goals;
DROP POLICY IF EXISTS "Savings goals can be deleted by owner" ON public.savings_goals;
DROP POLICY IF EXISTS "Users can manage own savings goals" ON public.savings_goals;

CREATE POLICY "Users can manage own savings goals" ON public.savings_goals
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- RECURRING TRANSACTIONS
DROP POLICY IF EXISTS "Recurring transactions are viewable by owner" ON public.recurring_transactions;
DROP POLICY IF EXISTS "Recurring transactions can be inserted by owner" ON public.recurring_transactions;
DROP POLICY IF EXISTS "Recurring transactions can be updated by owner" ON public.recurring_transactions;
DROP POLICY IF EXISTS "Recurring transactions can be deleted by owner" ON public.recurring_transactions;
DROP POLICY IF EXISTS "Users can manage own recurring transactions" ON public.recurring_transactions;

CREATE POLICY "Users can manage own recurring transactions" ON public.recurring_transactions
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- FUND ALLOCATIONS
DROP POLICY IF EXISTS "Users can manage own fund allocations" ON public.fund_allocations;

CREATE POLICY "Users can manage own fund allocations" ON public.fund_allocations
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- PROFILES
DROP POLICY IF EXISTS "Profiles are viewable by owner" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can manage own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
